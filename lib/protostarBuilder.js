/**
 * Copyright 2014 IBM Corp.
 * 
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 * 
 *      http://www.apache.org/licenses/LICENSE-2.0
 * 
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 *
 */
"use strict";
const path = require("path");
const fs = require("./filesystem");
const jqueryRunner = require("./jqueryRunner");
// var lessCompiler = require("./lessCompiler");
const lessCssSupport = require('./lessCssSupport');
const jadeUtils = require("./jadeUtils");
const utils = require("./utils");
const sassCompiler = require("./sassCompiler");
const deferred = require("deferred");
//var AdmZip = require("adm-zip");
const copier = require("./copier");
const blueBirdPromise = require("bluebird");
const logger = utils.createLogger({sourceFilePath: __filename});
const zipUtils = require("./zipUtils");
const osTmpdir = require("os-tmpdir");



/**
 *
 * @param {String} cmpDir
 * @return {boolean}
 */
function prepareComponentDir(cmpDir){
    //var that = this;
    copier.listDirChildrenFullPathsRecursively(cmpDir).forEach(function (p) {
        if(p.indexOf('-') >0 && p.substring(p.lastIndexOf('-')) === '-compiled.css'){
            fs.unlinkSync(p);
        }
    });
    const paths = copier.listDirChildrenFullPathsRecursively(cmpDir);
    const removedIdxs = [];
    const toRemove = [];
    const files = {
        html: [],
        css: [],
        js: []
    };
    const lessPaths = [];
    paths.forEach(function(p, idx){
        const ext = path.extname(p);
        switch (ext){
            case '.less':
                lessPaths.push(p); // jshint ignore:line
            case '.jade':
            case '.scss':
                fs.unlinkSync(p);
                toRemove.push(p);
                removedIdxs.push(idx);
                break;
            case '.html':
                files.html.push(p);
                break;
            case '.js':
                files.js.push(p);
                break;
            case '.css':
                files.css.push(p);
                break;
            default:
                break;
        }
    });
    console.log("Found component files: ", files);
    removedIdxs.reverse();
    removedIdxs.forEach(function(idx){
        paths.splice(idx, 1);
    });

    const relativeFiles = {
        html: utils.relativize(files.html, cmpDir),
        js: utils.relativize(files.js, cmpDir),
        css: utils.relativize(files.css, cmpDir)
    };
    console.log("Relativized component files: ", relativeFiles);
    const allReferenceables = ([].concat(relativeFiles.js).concat(relativeFiles.css)).map(function (r) {
        return r.replace(/\\/g, '/');
    });
    console.log("Checking for referenceables : ", allReferenceables);
    files.html.forEach(function(htmlPath){
        allReferenceables.forEach(function(refPath){
            let html = utils.readTextFileSync(htmlPath);
            html = html.replace(/contenteditable="true"/,"");
            try {
                const query = refPath + '"';
                const endIdx = html.indexOf(query);
                if (endIdx > 0) {
                    const attrName = path.extname(refPath) === ".js" ? "src" : "href";
                    const firstQuoteIdx = html.lastIndexOf('"', endIdx);
                    const closingQuote = html.indexOf('"', firstQuoteIdx + 1);
                    const toReplace = attrName + "=" + html.substring(firstQuoteIdx, closingQuote + 1);
                    const replacement = attrName + '="' + refPath + '"';
                    let outHtml = "" + html;
                    if(toReplace !== replacement){
                        let lastCritIdx = outHtml.lastIndexOf(toReplace);
                        while (lastCritIdx >= 0) {
                            const before = outHtml.substring(0, lastCritIdx);
                            const after = outHtml.substring(lastCritIdx + toReplace.length);
                            outHtml = before + replacement + after;
                            lastCritIdx = outHtml.lastIndexOf(toReplace);
                        }
                    }
                    if (html !== outHtml) {
                        outHtml = utils.beautifyHtml(outHtml);
                        utils.writeFile(htmlPath, outHtml);
                    }
                }
            } catch (e) {
                console.error("Error during processing " + cmpDir, e);
                throw e;
            }
        });
        const surroundAsFullHtmlDocForScriptPortlet = true;
        if(surroundAsFullHtmlDocForScriptPortlet){
            const newTxt = '<html><head></head><body>' + fs.readFileSync(htmlPath, 'utf8') + '</body></html>';
            fs.writeFileSync(htmlPath, newTxt, 'utf8');
        }
    });
    const easy = relativeFiles.html.length === 1 && relativeFiles.js.length <= 1 && relativeFiles.css.length <= 1;
    if(easy){
        const htmlPath = files.html[0];
        let cnt = "";
        let read = false;
        let initCnt = "";
        if(relativeFiles.js.length === 1){
            cnt = utils.readTextFileSync(htmlPath);
            initCnt = "" + cnt;
            read = true;
            const firstJs = relativeFiles.js[0];
            if(cnt.indexOf(firstJs + '"') < 0){
                const src = firstJs;
                const scriptTag = '\n' + '<script type="text/javascript" src="' + src + '"></script>' + '\n';
                console.log("Adding script tag to " + htmlPath + " for " + firstJs);
                cnt += scriptTag;
            }
        }
        if(relativeFiles.css.length === 1){
            if(!read){
                cnt = utils.readTextFileSync(htmlPath);
                initCnt = "" + cnt;
            }
            const firstCss = relativeFiles.css[0];
            if(cnt.indexOf(firstCss + '"') < 0){
                const linktag = '<link rel="stylesheet" href="' + firstCss + '"/>';
                cnt = '\n'+linktag+'\n' + cnt;
                console.log("Adding css link tag to " + htmlPath + " for " + firstCss);
            }
        }
        if(read && (cnt.length > 0 && (initCnt !== cnt))){
            utils.writeFile(htmlPath, cnt);
        }
        logger.info("Prepared an easy portlet: " + cmpDir);
    }else{
        logger.info("Not an easy portlet: " + cmpDir + ": ", relativeFiles);
    }
    return easy;
}


function Builder(args) {
    let project, composer, ignoreExcludeFromBuild, targetDir, runtime;
    const cleanupCompiledHtml = false;

    const lessSourceCssTargets = {};
    const sassSourceCssTargets = {};


    function copyDep(source, target) {
        if (source === runtime.constructProjectPath("")) {
            throw new Error("Trying to copy project dir to " + target);
        }

        if(source.indexOf(targetDir) === 0){
            throw new Error("Trying to copy from targetDir !" + source);
        }
        logger.debug("Copy " + source + " => " + target);
        if (!runtime.isExistingPath(source)) {

            const lessPath = source.substring(0, source.lastIndexOf('.')) + '.less';
            const sassPath = source.substring(0, source.lastIndexOf('.')) + '.scss';

            if(path.extname(source) === '.css' && runtime.isExistingPath(lessPath)){

                lessSourceCssTargets[lessPath] = target;
                logger.info("Queued less compilation: ", lessSourceCssTargets);

                return;
            }else if(path.extname(source) === '.css' && runtime.isExistingPath(sassPath)){

                sassSourceCssTargets[sassPath] = target;
                logger.info("Queued sass compilation: ", sassSourceCssTargets);

                return;
            }else{
                logger.error("NON EXISTING: " + source);
                throw new Error("Non existing path! " + source);
            }
        }
        copier.ensureParentDirExists(target);
        if (runtime.isExistingFilePath(source)) {
            logger.debug("Copying FILE " + source + " => " + target);
            runtime.writeFile(target, runtime.readFile(source) + "");
        } else {
            logger.debug("Copying DIR " + source + " => " + target);
            copier.copy(source, target);
        }
    }

    this.createZipBuild = function(callback){
        const dirName = path.basename(targetDir);
        this.buildPrototype().done(function(){
            if(!targetDir) throw new Error("Illegal target dir");
            const zipPath = osTmpdir() + path.sep + 'built_' + dirName + '_' + new Date().getTime() + '.zip';
            zipUtils.zipDirectoryAs(targetDir, dirName, zipPath);
            callback(zipPath, targetDir, dirName);
        }, function(errors){
            logger.error("create zip build errors", errors.stack);
            callback();
            throw new Error("Callback errors!");
        });
    };

    function createCopySourceFromTargetPath(absoluteTargetDepUrl){
        let copySource;
        const atdu = absoluteTargetDepUrl;
        const td = targetDir;
        const withoutTargetDir = atdu.substring(td.length);
        const bowerTargetPrefix = (td + "/ps/ext/");
        const nodeTargetPrefix = (td + "/ps/nm/");
        const internalDepTargetPrefix = td + "/ps/";
        if(atdu.indexOf(bowerTargetPrefix) === 0){
            const bowerDepName = atdu.substring(bowerTargetPrefix.length, atdu.indexOf('/', bowerTargetPrefix.length));
            copySource = runtime.constructAppPath(['bower_components', bowerDepName]);
        }else if(atdu.indexOf(nodeTargetPrefix) === 0){
            const nodeDepName = atdu.substring(nodeTargetPrefix.length, atdu.indexOf('/', nodeTargetPrefix.length));
            copySource = runtime.constructAppPath(['node_modules', nodeDepName]);
        }else if(atdu.indexOf(internalDepTargetPrefix) === 0){
            const internalDepDirname = atdu.substring(internalDepTargetPrefix.length, atdu.indexOf('/', internalDepTargetPrefix.length));
            copySource = runtime.constructAppPath(['core', internalDepDirname]);

        }else if(atdu.indexOf(td + "/ps/dynamic/") === 0){
            throw new Error("todo: build dynamic resources: " + atdu);
        }else if(runtime.namedPathsConfig.isNamedPathUrlPathname(withoutTargetDir)){
            const npName = runtime.namedPathsConfig.resolveUrlPathnameToNamedPathName(withoutTargetDir);
            const np = runtime.namedPathsConfig.getNamedPath(npName);
            copySource = np.path;
        }else if(runtime.isProjectFileUrlPathname(withoutTargetDir)){
            let projectSource;
            const secondSlash = withoutTargetDir.indexOf('/', 1);
            let projectChild;
            if(secondSlash > 0){
                projectChild = path.dirname(withoutTargetDir).substring(1);//withoutTargetDir.substring(1, secondSlash);
            }else{
                projectChild = withoutTargetDir.substring(1);
            }
            projectSource = runtime.constructProjectPath(projectChild);
            copySource = projectSource;
        }else{
            throw new Error("Uncategorized source file target url path : " + atdu);
        }
        return copySource;
    }

    function createCopyTargetFromTargetPath(absoluteTargetDepUrl){
        let copyTarget;
        const atdu = absoluteTargetDepUrl;
        const td = targetDir;
        const withoutTargetDir = atdu.substring(td.length);
        const bowerTargetPrefix = (td + "/ps/ext/");
        const nodeTargetPrefix = (td + "/ps/nm/");
        const internalDepTargetPrefix = td + "/ps/";
        if(atdu.indexOf(bowerTargetPrefix) === 0){
            const bowerDepName = atdu.substring(bowerTargetPrefix.length, atdu.indexOf('/', bowerTargetPrefix.length));
            copyTarget = bowerTargetPrefix + bowerDepName;
        }else if(atdu.indexOf(nodeTargetPrefix) === 0){
            const nodeDepName = atdu.substring(nodeTargetPrefix.length, atdu.indexOf('/', nodeTargetPrefix.length));
            copyTarget = nodeTargetPrefix + nodeDepName;
        }else if(atdu.indexOf(internalDepTargetPrefix) === 0){
            const internalDepDirname = atdu.substring(internalDepTargetPrefix.length, atdu.indexOf('/', internalDepTargetPrefix.length));
            copyTarget = internalDepTargetPrefix + internalDepDirname;
        }else if(atdu.indexOf(td + "/ps/dynamic/") === 0){
            throw new Error("todo: build dynamic resources: " + atdu);
        }else if(runtime.namedPathsConfig.isNamedPathUrlPathname(withoutTargetDir)){
            const npName = runtime.namedPathsConfig.resolveUrlPathnameToNamedPathName(withoutTargetDir);
            const np = runtime.namedPathsConfig.getNamedPath(npName);
            copyTarget = td + np.url;
        }else if(runtime.isProjectFileUrlPathname(withoutTargetDir)){
            const secondSlash = withoutTargetDir.indexOf('/', 1);

            let projectChild;
            if(secondSlash > 0){
                projectChild = path.dirname(withoutTargetDir);
            }else{
                projectChild = withoutTargetDir;
            }
            copyTarget = td + projectChild;
        }else{
            throw new Error("Uncategorized source file target url path : " + atdu);
        }
        return copyTarget;
    }

    // for each dependency (file necessary for properly viewing built project)
    // sourceFile, targetFile, projectPath, targetDir, type (namedpath, project, appfile, ..)



    function copyDependencyDirs(absoluteTargetDepUrl, copiedDirPathsMap){
        const def = deferred();
        let namedPathUrlPathname = runtime.namedPathsConfig.isNamedPathUrlPathname('/' + absoluteTargetDepUrl);
        logger.debug("COPY DEP DIR " + absoluteTargetDepUrl + ", isnamed url pathname? " + namedPathUrlPathname);
        if(!namedPathUrlPathname){
            const projEquivPath = runtime.constructProjectPath(absoluteTargetDepUrl.substring(targetDir.length + 1));
            const lessEquiv = projEquivPath.substring(0, projEquivPath.lastIndexOf('.')) + ".less";
            const sassEquiv = projEquivPath.substring(0, projEquivPath.lastIndexOf('.')) + ".sass";
            logger.debug("proj equiv = " + projEquivPath);
            logger.debug("less equiv = " + lessEquiv);
            logger.debug("sass equiv = " + sassEquiv);
            const shouldCompileLess = projEquivPath.indexOf('.css') === (projEquivPath.length - 4) && !runtime.isExistingFilePath(projEquivPath) && runtime.isExistingFilePath(lessEquiv);
            const shouldCompileSass = projEquivPath.indexOf('.css') === (projEquivPath.length - 4) && !runtime.isExistingFilePath(projEquivPath) && runtime.isExistingFilePath(sassEquiv);
            if(path.extname(projEquivPath) === '.css'){
                logger.debug("Should compile " + projEquivPath + " (" + absoluteTargetDepUrl + ")? " + shouldCompileLess);
            }
            if(shouldCompileLess){
                logger.debug("Compiling lesscss " + lessEquiv + "...");
                lessCssSupport.compile(lessCssSupport.createRequest(lessEquiv, runtime.constructProjectPath(""))).then((resolved)=>{
                    logger.info("Compiled lesscss" + lessEquiv);

                    ensureWriteCss(absoluteTargetDepUrl, resolved.css, resolved.cssMap, resolved.dependencies);
                    def.resolve();
                }, (error) => {
                    logger.error("Error while compiling lesscss " + lessEquiv, error.stack);
                    def.reject(error);
                });
                // lessCompiler.compilePromise(lessEquiv, [path.dirname(lessEquiv) + ""], "" + runtime.readFile(lessEquiv), runtime.constructProjectPath(""))
                //     .done(function (css, sourceMap, depPaths) {
                //
                //     }, function(error){
                //
                //     });
                return def.promise;
            }else if(shouldCompileSass){
                logger.debug("Compiling sass " + sassEquiv + "...");
                sassCompiler.renderSass(runtime.readFile(sassEquiv)+"", [path.dirname(sassEquiv) + ""], path.basename(projEquivPath), function(css, cssmap, stats){
                    logger.info("Compiled sess " + sassEquiv, stats);
                    ensureWriteCss(absoluteTargetDepUrl, css, cssmap, stats);
                    def.resolve();
                });
                return def.promise;
            }
        }

        logger.debug("initiate copy dep for target path " + absoluteTargetDepUrl);
        let atdu = absoluteTargetDepUrl;

        if(absoluteTargetDepUrl.indexOf("://") > 0 || absoluteTargetDepUrl.indexOf("//") === 0){
            logger.info("Not copying external url : " + absoluteTargetDepUrl);
            def.resolve();
            return def.promise;
        }
        if(atdu.indexOf("ps:/") === 0){
            atdu = targetDir + atdu.substring(3);
            logger.info("Corrected ps:attr absolute path " + absoluteTargetDepUrl + " -> " + atdu);
        }else if(absoluteTargetDepUrl.indexOf("ps:") === 0){
            const npNameEndSlash = absoluteTargetDepUrl.indexOf('/', 4);
            const npNamePotential = absoluteTargetDepUrl.substring(3, npNameEndSlash);
            logger.debug("NAMED PATH POTENTIAL : " + npNamePotential);
            if(runtime.namedPathsConfig.isNamedPathName(npNamePotential)){
                atdu = targetDir + runtime.namedPathsConfig.getNamedPath(npNamePotential).url + absoluteTargetDepUrl.substring(npNameEndSlash);
                logger.info("Corrected named path in ps:attr from " + absoluteTargetDepUrl + " -> " + atdu);
            }else{
                throw new Error("Add handling for non-named-link non root ps: link attrs! " + absoluteTargetDepUrl);
            }

        }else  if(atdu.indexOf('./') === 0 || atdu.indexOf('../') === 0){
            throw new Error("TODO relative support : " + atdu);
        } else if(atdu.indexOf('/') !== 0){
            if(runtime.namedPathsConfig.isNamedPathName(atdu.substring(0, atdu.indexOf('/')))){
                atdu = targetDir + '/' + atdu;//.substring(atdu.indexOf('/')+1);
            }else{
                logger.warn("not handling RELATIVE URL : " + atdu);
                def.resolve();
                return def.promise;
            }
        }else if(absoluteTargetDepUrl.indexOf(targetDir) !== 0){
            atdu = targetDir + absoluteTargetDepUrl;
        }

        if (atdu.indexOf(".less?compile") > 0) {
            const urlPathname = atdu.substring(targetDir.length, atdu.length - 8);
            const targetPath = atdu.substring(0, atdu.length - 8);
            const sourceFilePath = runtime.findFileForUrlPathname(urlPathname);
            if(!copiedDirPathsMap.hasOwnProperty(sourceFilePath)){
                copiedDirPathsMap[sourceFilePath] = targetPath;
                lessCssSupport.compile(lessCssSupport.createRequest(sourceFilePath, runtime.constructProjectPath(""))).then((c) => {
                    const cssTargetPath = targetPath; //targetDir + "/ps/nm/" + u;
                    ensureWriteCss(cssTargetPath, c.css, c.cssMap, c.dependencies);
                    def.resolve();
                }, (errors) => {
                    logger.error("LESS ERROR", errors.stack);
                    def.reject(errors);
                });
                // lessCompiler.compilePromise(sourceFilePath, [path.dirname(sourceFilePath) + ""], "" + runtime.readFile(sourceFilePath), runtime.constructProjectPath("")).done(function (css, sourceMap, depPaths) {
                //
                // }, function(errors){
                //
                // });
                return def.promise;
            }else{
                logger.info("Already compiled less " + sourceFilePath + " -> " + targetPath);
                def.resolve();
                return def.promise;
            }
        }else{
            const copySource = createCopySourceFromTargetPath(atdu);
            const copyTarget = createCopyTargetFromTargetPath(atdu);

            if(!copiedDirPathsMap.hasOwnProperty(copySource) && copySource !== runtime.constructProjectPath(".")){
                copiedDirPathsMap[copySource] = copyTarget;
                copyDep(copySource, copyTarget);
            }else{
                logger.debug("Already copied " + copySource + " -> " + copyTarget);
            }
        }
        def.resolve();
        return def.promise;
    }

    const modifyBuiltMarkupWithJQuery = function ($) {
        jqueryRunner.assignUniqueIdsToEditables($);
        if (!ignoreExcludeFromBuild) {
            jqueryRunner.removeMarkupIgnoredForBuild($);
        }
        jqueryRunner.processProtostarAttributes($, function (attrName, attrVal) {
            return runtime.determineProtostarAttributeValue(attrName, attrVal, targetDir);
        });
        $("*[data-editable]").attr("contenteditable", "false");
        jqueryRunner.convertAbsoluteToTargetReferences($, targetDir);
        /*metadata.templateTargetPath = createTargetPathForTemplate(metadata.templatePath)
        metadata.targetDir = targetDir;
        jqueryRunner.createPageRelativeReferences($, targetDir, metadata);*/
//        return '<!doctype html>\n' + $("html")[0].outerHTML;
        let doctype = '<!doctype html>';
        return /*doctype + '\n' +*/ $.html();
//return doctype + '\n' + window.document.documentElement.outerHTML; //$("html")[0].outerHTML;
    };

    const modifyBuiltMarkupToRelativeWithJQuery = function ($, window, metadata) {
        try {
            jqueryRunner.assignUniqueIdsToEditables($);
            if (!ignoreExcludeFromBuild) {
                jqueryRunner.removeMarkupIgnoredForBuild($);
            }
            jqueryRunner.processProtostarAttributes($, function (attrName, attrVal) {
                return runtime.determineProtostarAttributeValue(attrName, attrVal, targetDir);
            });
            $("*[data-editable]").attr("contenteditable", "false");
            jqueryRunner.convertAbsoluteToTargetReferences($, targetDir);
            metadata.templateTargetPath = createTargetPathForTemplate(metadata.templatePath);
            metadata.targetDir = targetDir;
            jqueryRunner.createPageRelativeReferences($, targetDir, metadata);
            let doctype = '<!doctype html>';
            return /*doctype + '\n' +*/ $.html();
        } catch (jqfe) {
            logger.error("Error while running modifyBuiltMarkupToRelativeWithJQuery", jqfe.stack);
            throw jqfe;
        }
    };

    const postProcessComposed = function (markup) {
        return (function () {
            const def = deferred();
            if (markup.content.trim().length > 1) {
                jqueryRunner.runJQuery(markup.content, modifyBuiltMarkupWithJQuery, function (result, errors) {
                    //var args = {};
                    if (errors) {
                        def.reject(errors);
                    } else {
                        def.resolve(result);
                    }
                    //done(result, errors, args);
                }, markup.metadata);
            } else {
                //done(markup.content, null, undefined);
                def.resolve(markup.content);
            }
            return def.promise;
        })(markup);
    };

    const postProcessComposedForRelative = function (markup) {
        return (function () {
            const def = deferred();
            if (markup.content.trim().length > 1) {
                jqueryRunner.runJQuery(markup.content, modifyBuiltMarkupToRelativeWithJQuery, function (result, errors) {
                    if (errors) {
                        def.reject(errors);
                    } else {
                        def.resolve(result);
                    }
                }, markup.metadata);
            } else {
                def.resolve(markup.content);
            }
            return def.promise;
        })(markup);

    };

    const targetDirExists = function () {
        let exists = false;
        if (runtime.isExistingPath(targetDir)) {
            if (runtime.isExistingDirPath(targetDir)) {
                exists = true;
            } else {
                throw new Error("Build targetDir path exists but it's no directory: " + targetDir);
            }
        }
        return exists;
    };

    const emptyTargetDir = function () {
        const files = runtime.listDir(targetDir);
        files.forEach(function (f) {
            const fp = targetDir + "/" + f;
            if (runtime.isExistingDirPath(fp)) {
                copier.deleteRecursively(fp);
            } else {
                runtime.deleteFile(fp);
            }
        });
        logger.info("Emptied " + targetDir);
    };

    function ensureWriteCss(targetPath, css, sourceMap, deps) {
        copier.ensureParentDirExists(targetPath);
        logger.info("Writing css to " + targetPath);
        logger.debug("DEPS = ",deps);
        runtime.writeFile(targetPath, "" + css);
        if(targetPath.indexOf('.less') === (targetPath.length-5)){
            const dir = path.dirname(targetPath);
            let baseFileName = path.basename(targetPath);
            baseFileName= baseFileName.substring(0, baseFileName.lastIndexOf('.'));
            const basePath = dir + '/' + baseFileName;
            const cssPathForLess = basePath + ".css";
            runtime.writeFile(cssPathForLess, "" + css);
            const sourceMapPathForLess = basePath + ".css.map";
            runtime.writeFile(sourceMapPathForLess, "" + sourceMap);
            if(deps){
                runtime.writeFile(basePath + ".deps.json", JSON.stringify(deps));
            }
        }else if(targetPath.indexOf('.css') === (targetPath.length - 4)){
            const cssPath = targetPath;
            runtime.writeFile(cssPath, "" + css);
            const sourceMapPath = targetPath + ".map";
            runtime.writeFile(sourceMapPath, "" + sourceMap);
            if(deps){
                runtime.writeFile(targetPath + ".deps.json", JSON.stringify(deps));
            }
        }

    }

    const createConcatHtmlDocument = function (htmlDocumentMarkups) {
        let concat = "";
        htmlDocumentMarkups.forEach(function (doc) {
            concat += doc;
        });
        concat = concat.replace(new RegExp('\\<!doctype[^>]*\\>', 'g'), '');
        concat = concat.replace(new RegExp('\\<!DOCTYPE[^>]*\\>', 'g'), '');
        concat = concat.replace(new RegExp('\\<html[^>]*\\>', 'g'), '');
        concat = concat.replace(new RegExp('\\</html\\>', 'g'), '');
        concat = concat.replace(new RegExp('\\<head[^>]*\\>', 'g'), '');
        concat = concat.replace(new RegExp('\\</head\\>', 'g'), '');
        concat = concat.replace(new RegExp('\\<body[^>]*\\>', 'g'), '');
        concat = concat.replace(new RegExp('\\</body\\>', 'g'), '');
        return concat;
    };

    const createTargetPathForTemplate = function (templatePath) {
        return targetDir + runtime.createUrlPathForFile(templatePath);
    };

    const copyProjectDependencies = function () {
        const projectConfig = runtime.readProjectConfig();
        if (utils.nestedPathExists(projectConfig, "build", "resourceDirs", "project") && utils.getObjectType(projectConfig.build.resourceDirs.project) === 'Array') {
            projectConfig.build.resourceDirs.project.forEach(function (projPath) {
                copyDep(runtime.constructProjectPath(projPath), targetDir + "/" + projPath);
            });
        } else {
            logger.warn("No resourceDirs defined in prototype.json at build.resourceDirs");
        }
    };

    const finalRun = function (compiledTemplates, callBack) {
        const outFiles = [];
        let written = 0;
        for (let tp in compiledTemplates) {

            const ct = compiledTemplates[tp];

            outFiles.push(ct);

            const targetFilePath = createTargetPathForTemplate(ct.path);//"/" + ct.name;

            console.info("Compiling page " + (written + 1) + ": " + targetFilePath);

            runtime.mkdirs(path.dirname(targetFilePath));

            logger.debug("Writing file to " + targetFilePath);
            if (cleanupCompiledHtml) {
                logger.debug("Removing comments from " + path.basename(targetFilePath));
                const removedComments = utils.removeAllHtmlComments(ct.compiled);
                logger.debug("Beautifying " + path.basename(targetFilePath));
                const beautified = utils.beautifyHtml(removedComments).replace(/^\s*[\r\n]/gm, "");
                runtime.writeFile(targetFilePath, beautified);
            } else {
                runtime.writeFile(targetFilePath, ct.compiled);
            }
            logger.debug("Wrote built file " + targetFilePath);
            written++;
            if (written % 10 === 0) {
                logger.info("Wrote " + written + "/" + compiledTemplates.length + " pages");
            }
        }
        logger.info("Finished compiling " + compiledTemplates.length + " templates");
        logger.debug("CALLBACK ==== " + callBack.toString());
        callBack(outFiles);
    };


    const afterPostProcessing = function (compiledTemplates, callBack) {
        const outFiles = [];
        for (let tp in compiledTemplates) {
            const ct = compiledTemplates[tp];
            outFiles.push(ct);
            const targetFilePath = createTargetPathForTemplate(ct.path);//"/" + ct.name;
            runtime.mkdirs(path.dirname(targetFilePath));
        }
        const markups = [];
        outFiles.forEach(function (of) {
            markups.push(of.compiled);
        });
        const concat = createConcatHtmlDocument(markups);
        jqueryRunner.runJQuery(concat, function ($) {
            const config = {
                script: "src",
                link: "href",
                img: "src"
            };
            return jqueryRunner.collectReferenceAttributeValues($, config);
        }, function (result) {
            logger.info("Found unique dependency links in pages : ", result);
            const out = result;
            if (!fs.existsSync(targetDir + "/ps"))
            runtime.mkdir(targetDir + "/ps");
            if (!fs.existsSync(targetDir + "/ps/ext"))
            runtime.mkdir(targetDir + "/ps/ext");
            if (!fs.existsSync(targetDir + "/ps/assets"))
            runtime.mkdir(targetDir + "/ps/assets");
            if (!fs.existsSync(targetDir + "/ps/nm"))
            runtime.mkdir(targetDir + "/ps/nm");
            copyProjectDependencies();
            const copiedMap = {};
            const promises = [];
            for (let scriptDepUrl in out.script) {
                promises.push(copyDependencyDirs(scriptDepUrl, copiedMap));
            }
            //var cssPromises = [];
            for (let linkDepUrl in out.link) {
                promises.push(copyDependencyDirs(linkDepUrl, copiedMap));

            }
            for (let imgDepUrl in out.img) {
                promises.push(copyDependencyDirs(imgDepUrl, copiedMap));
            }

            for (let queuedLess in lessSourceCssTargets) {
                promises.push(compileLess(queuedLess, lessSourceCssTargets[queuedLess]));
            }
            for (let queuedSass in sassSourceCssTargets) {
                promises.push(compileSass(queuedSass, sassSourceCssTargets[queuedSass]));
            }
            deferred.apply(this, promises)(function () {
                logger.info("All copies are done !");
                makeBuildRelative(compiledTemplates, function () {
                    compileThemes(callBack);
                });
            });
        });
    };

    const compileLess = function (sourcePath, targetPath) {
        const def = deferred();
        lessCssSupport.compile(lessCssSupport.createRequest(sourcePath, runtime.constructProjectPath(""))).then((c) => {
            logger.info("Compiled " + sourcePath);
            ensureWriteCss(targetPath, c.css, c.cssMap, c.dependencies);
            def.resolve();
        }, (error) => {
            logger.error("Error while compiling " + sourcePath, error.stack);
            def.reject(error);
        });
        // lessCompiler.compilePromise(sourcePath, [path.dirname(sourcePath) + ""], "" + runtime.readFile(sourcePath), runtime.constructProjectPath(""))
        //     .done(function (css, sourceMap, depPaths) {
        //
        //     }, function(error){
        //
        //     });
        return def.promise;
    };
    const compileSass = function (sourcePath, targetPath) {
        const def = deferred();
        sassCompiler.renderSass(runtime.readFile(sourcePath) + "", [path.dirname(sourcePath) + ""], path.basename(sourcePath), function (css, cssmap, stats) {
            logger.info("Compiled " + sourcePath, stats);
            ensureWriteCss(targetPath, css, cssmap, stats);
            def.resolve();
        });
        return def.promise;
    };

    const compileThemes = function (callBack) {
        function compileTheme(themeName) {
            return (function (themeName) {
                const def = deferred();
                logger.info("THEME NAME = " + themeName);
                lessCssSupport.compile(lessCssSupport.createRequest(entryPoint, runtime.constructProjectPath(""), {
                    globalVars: {themeName: themeName},
                    modifyVars: {themeName: themeName}
                })).then((c) => {
                    done++;
                    logger.info("Finished compiling THEME " + done + "/" + themeNames.length + " = " + themeName);
                    const cssTargetPath = targetDir + "/" + projectConfig.theming.entryPoint; //targetDir + "/ps/nm/" + u;
                    ensureWriteCss(cssTargetPath + "-" + themeName + ".css", c.css, c.cssMap, c.dependencies);
                    def.resolve();
                }, (error) => {
                    logger.error("LESS compilation error", error.stack);
                    def.reject(error);
                });
                // lessCompiler.compilePromise(entryPoint, [path.dirname(entryPoint) + ""], "" + runtime.readFile(entryPoint), runtime.constructProjectPath(""),  {
                //     globalVars: {themeName:themeName},
                //     modifyVars: {themeName:themeName}
                // }).done(function (css, sourceMap, depPaths) {
                //
                // }, function(error){
                //
                // });
                return def.promise;
            })(themeName);
        }


        const projectConfig = runtime.readProjectConfig();
        if (utils.nestedPathExists(projectConfig, "theming", "enabled") && typeof projectConfig.theming.enabled === 'boolean' && projectConfig.theming.enabled) {
            const entryPoint = project.resolveProjectFile(projectConfig.theming.entryPoint);
            const themeNames = projectConfig.theming.themeNames;
            const defaultThemeName = projectConfig.theming.defaultThemeName;
            let themeNameVar = projectConfig.theming.themeNameVar;
            const compileThemes = projectConfig.theming.compileThemes;
            let compileDefaultThemeOnly = projectConfig.theming.compileDefaultThemeOnly;
            logger.info("DEFAULT THEME NAME = " + defaultThemeName);
            logger.info("ENTRY POINT = " + entryPoint);
            const done = 0;

            deferred.map(themeNames, function (themeName) {
                return compileTheme(themeName);
            })(function () {
                logger.info("AFinished compiling THEME = ");
                callBack();
            });
        } else {
            logger.info("Theming not enabled for project");
            callBack();
        }
    };

    const prepareTargetDirectory = function () {
        if (typeof targetDir !== 'string') {
            throw new Error("Illegal targetDir: " + targetDir);
        }
        if (targetDirExists()) {
            if (!runtime.isExistingFilePath(path.join(targetDir, ".protostar-project-built"))) {
                throw new Error("targetDir probably wasnt created by protostar (doesnt contain file .protostar-project-built) so refusing to delete/overwrite! " + targetDir);
            }
            emptyTargetDir();
            runtime.writeFile(path.join(targetDir, ".protostar-project-built"), "This directory is created by building a Protostar prototype so can be overwritten by protostar.");
        } else {
            logger.info("Created build target directory: " + targetDir);
            runtime.mkdirs(targetDir);
            runtime.writeFile(path.join(targetDir, ".protostar-project-built"), "This directory is created by building a Protostar prototype so can be overwritten by protostar.");
        }
    };

    const shouldIncludeNamedPathsInCompilation = function (projectConfig) {
        let includeNamedPathsInCompilation = false;
        if (utils.nestedPathExists(projectConfig, "build", "includeNamedPaths") && utils.hasPropertyOfType(projectConfig.build, "includeNamedPaths", "Boolean")) {

            includeNamedPathsInCompilation = projectConfig.build.includeNamedPaths;
            logger.info("Include named paths in compilation? " + includeNamedPathsInCompilation);
        }
        return includeNamedPathsInCompilation;
    };

    const determineExcludedPaths = function (projectConfig) {
        const excludedPaths = [];
        if (utils.nestedPathExists(projectConfig, "build", "excludedPaths") && utils.hasPropertyOfType(projectConfig.build, "excludedPaths", "Array")) {
            projectConfig.build.excludedPaths.forEach(function (ep) {
                let excludedPath;
                if (ep.indexOf("/") === 0) {
                    excludedPath = ep;
                } else {
                    excludedPath = path.normalize(runtime.constructProjectPath(ep));
                }
                logger.info("Excluding path from build: " + excludedPath);
                excludedPaths.push(excludedPath);
            });
        }
        return excludedPaths;
    };

    let headerIdx = 0;

    function logHeaderIndexed(heading){
        headerIdx++;
        const msg = "" + headerIdx + ". " + heading;
        console.log("\n\n" + msg);
        let line = '';
        for(let l = 0 ; l < msg.length+3 ; l++){
            line += '#';
        }
        console.log(line + "\n\n");
    }

    const buildPrototype = function () {
        return (function () {
            const def = deferred();
            logHeaderIndexed("Updating dynamic (discover templates etc)");
            project.updateDynamic();
            const jadeTemplates = project.listProjectJadeTemplatePaths();
            logHeaderIndexed("Preprocessing " + jadeTemplates.length + " JADE template paths");
            logger.info("Found " + jadeTemplates.length + " JADE templates. Compiling ...");
            jadeTemplates.forEach(function (jt) {
                logger.debug("Compiling JADE template found: " + jt);
                const result = jadeUtils.jadeFileToHtmlFile(jt);
                logger.debug("Compiled JADE to HTML first : " + result.path);
            });
            logger.info("Compiled " + jadeTemplates.length + " JADE templates.");

            prepareTargetDirectory();
            const projectConfig = runtime.readProjectConfig();
            const includeNamedPathsInCompilation = shouldIncludeNamedPathsInCompilation(projectConfig);
            const templates = project.listAllTemplatePaths();
            const excludedPaths = determineExcludedPaths(projectConfig);
            const compiledTemplates = {};
            let count = 0;
            let relativeCount = 0;

            templates.forEach(function (pagePath) {
                let includePage = true;
                excludedPaths.forEach(function (ep) {
                    if (pagePath.indexOf(ep) === 0) {
                        includePage = false;
                    }
                });
                if (includePage && (includeNamedPathsInCompilation || !runtime.namedPathsConfig.isNamedPathChild(pagePath))) {
                    const pageContents = runtime.readFile(pagePath);
                    if (pageContents.indexOf('{%') < 0 && pageContents.indexOf('%}')) {
                        const pageContentsCompiled = composer.composeTemplate(pagePath, pageContents);
                        logger.debug("Compiled for build: " + pagePath + " with metadata:", pageContentsCompiled.metadata);
                        postProcessComposed(pageContentsCompiled).done(function (pageContentsPostProcessed) {
                            compiledTemplates[pagePath] = {
                                name: pagePath,
                                path: pagePath,
                                compiled: pageContentsPostProcessed,
                                pageContents: pageContents,
                                pageContentsCompiled: pageContentsCompiled,
                                pageContentsPostProcessed: pageContentsPostProcessed
                            };
                            count += 1;
                            if (count === templates.length) {
                                logger.info("DONE all " + templates.length + " templates are compiled!");

                                afterPostProcessing(compiledTemplates, function () {
                                    const jtp = project.listProjectJadeTemplatePaths();
                                    let deleted = jadeUtils.deleteCompiledFilesForTemplates(jtp);
                                    def.resolve(compiledTemplates);
                                });
                            }
                        }, function (errors) {
                            logger.info("Errors :: ", errors.stack);
                            def.reject(errors);
                        });
                    } else {
                        logger.info("Not building file with jekyll directives: " + pagePath);
                        count += 1;
                        relativeCount += 1;
                        if (count === templates.length) {
                            logger.info("DONE all " + templates.length + " templates are compiled!");

                            afterPostProcessing(compiledTemplates, function () {
                                const jtp = project.listProjectJadeTemplatePaths();
                                let deleted = jadeUtils.deleteCompiledFilesForTemplates(jtp);
                                def.resolve(compiledTemplates);
                                //callBack()
                            });
                        }
                    }
                } else {
                    logger.info("Not including page template in named path: " + pagePath);
                    count += 1;
                    relativeCount += 1;
                    if (count === templates.length) {
                        logger.info("DONE all " + templates.length + " templates are compiled!");
                        afterPostProcessing(compiledTemplates, function () {
                            const jtp = project.listProjectJadeTemplatePaths();
                            let deleted = jadeUtils.deleteCompiledFilesForTemplates(jtp);
                            def.resolve(compiledTemplates);
                            //callBack()
                        });
                    }
                }
            });
            return def.promise;
        })();
    };

    const makeBuildRelative = function (compiledTemplates, callBack) {
        const allTemplatePaths = Object.keys(compiledTemplates);
        logger.debug("TEMPLATE PATHS FOR RELATIVE : ", allTemplatePaths);
        const relativizeCompiledTemplate = function (templatePath) {
            return function () {
                const def = deferred();
                const ct = compiledTemplates[templatePath];
                postProcessComposedForRelative(ct.pageContentsCompiled).done(function (contentsPostProcessedRelative) {
                    def.resolve({
                        path: templatePath,
                        compiled: contentsPostProcessedRelative
                    });
                }, function (errors) {
                    logger.error("making build relative threw errors!", errors.stack);
                    def.reject(errors);

                });
                return def.promise;
            }(templatePath);
        };
        const defAllTemplatePaths = function () {
            return function () {
                const def = deferred();
                def.resolve(allTemplatePaths);
                return def.promise;
            }();

        };
        defAllTemplatePaths().map(relativizeCompiledTemplate).done(function (data) {
            logger.debug("FINISHED RELATIVEZE : ", data);
            finalRun(data, callBack);
        }, function (errors) {
            logger.error("ERROR RELATIVEZE : ", errors.stack);
            callBack();
        });
    };

    /**
     *
     * @param {String[]} dirPaths
     * @param {String} targetDirPath
     * @param {Function} cb
     */
    this.buildComponentDirs = function(dirPaths, targetDirPath, cb){
        if(fs.existsSync(targetDirPath)){
            throw new Error("targetDirPath should not yet exist :" + targetDirPath);
        }
        if(!fs.existsSync(path.dirname(targetDirPath))){
            throw new Error("cannot create target dir below non existing dir : " + targetDirPath);
        }
        fs.mkdirSync(targetDirPath);
        const t = this;
        function buildSubDir(lp){
            return new blueBirdPromise(function(resolve){
                const ntd = path.resolve(targetDirPath, path.basename(lp));
                t.buildComponentDir(lp, ntd, function(err, builtToDir){
                    if(err){
                        resolve({
                            ok: false,
                            error: err,
                            target: ntd,
                            dir: lp
                        });
                    }else{
                        resolve({
                            ok: true,
                            error: err,
                            target: builtToDir,
                            dir: lp
                        });
                    }
                });
            });
        }
        const buildPromises = [];
        dirPaths.forEach(function(lp){
            buildPromises.push(buildSubDir(lp));
        });
        blueBirdPromise.all(buildPromises).then(function(results){
            console.log("Finished building " + dirPaths.length + " component dirs to " + targetDirPath);
            for(let i = 0 ; i < dirPaths.length ; i++){
                const res = results[i];
                if(res.ok){
                    console.info("Built component dir for : ", res);
                }else{
                    console.error("Could not build component dir for : ", res);
                }
            }

            cb(undefined, targetDirPath, results);
        }, function(err){
            console.error("Failed to run less compiles it seems", err);
            cb(err);
        }).catch(function(err){
            console.error("Caught error during less compiles it seems", err.stack);
            cb(err);
        });
    };

    this.buildComponentDir = function(dirPath, targetDirPath, cb){
        if(dirPath.indexOf(project.runtime.projectDirPath) !== 0){
            throw new Error("Dirpath must be a subdir of the project dir: " + dirPath);
        }
        const componentFiles = copier.listDirChildrenFullPathsRecursively(dirPath);
        if(fs.existsSync(targetDirPath)){
            throw new Error("targetDirPath should not yet exist :" + targetDirPath);
        }
        if(!fs.existsSync(path.dirname(targetDirPath))){
            throw new Error("cannot create target dir below non existing dir : " + targetDirPath);
        }
        fs.mkdirSync(targetDirPath);
        copier.copy(dirPath, targetDirPath);
        const htmlFiles = componentFiles.filter(function (p) {
            return path.extname(p) === '.html';
        });
        const jadeFiles = componentFiles.filter(function (p) {
            return path.extname(p) === '.jade';
        });
        const lessFiles = componentFiles.filter(function (p) {
            return path.extname(p) === '.less';
        });
        jadeFiles.forEach(function(f){
            const compiledData = jadeUtils.jadeFileToHtmlFile(f);
            const htmlPath = compiledData.path;
            htmlFiles.push(htmlPath);
        });
        copier.copy(dirPath, targetDirPath);
        htmlFiles.forEach(function(f){
            const compiledData = project.composer.composeTemplate(f, utils.readTextFileSync(f), 100);
            utils.writeFile(path.resolve(targetDirPath, f.substring(dirPath.length+1)), compiledData.content.replace(/contenteditable="true"/g, ""));
        });

        lessCssSupport.compileFiles(lessFiles.map((f) => {
            return lessCssSupport.createRequest(f, path.dirname(f))
        })).then((results) => {
            results.forEach((r) => {
                let lp = r.request.sourceFile;
                let css = r.css;
                let cssPath = lp.substring(dirPath.length+1);
                cssPath = cssPath.substring(0, cssPath.lastIndexOf('.'));
                cssPath += '.css';
                const thePath = path.resolve(targetDirPath, cssPath);
                utils.writeFile(thePath, css.toString());
                console.log("Wrote " + lp + " to " + thePath);
            });
            // for(var lp in cssPerPath){
            //     var css = cssPerPath[lp];
            //     var cssPath = lp.substring(dirPath.length+1);
            //     cssPath = cssPath.substring(0, cssPath.lastIndexOf('.'));
            //     cssPath += '.css';
            //     var thePath = path.resolve(targetDirPath, cssPath);
            //     utils.writeFile(thePath, css.toString());
            //     console.log("Wrote " + lp + " to " + thePath);
            // }
            console.log("Finished compiling to " + targetDirPath);
            prepareComponentDir(targetDirPath);
            cb(undefined, targetDirPath);
        }, (err) => {
            console.error("Failed to run less compiles it seems", arguments);
            cb(err, targetDirPath);
        })

        // lessCompiler.compileLessFilesToCss(lessFiles, function(err, cssPerPath){
        //     if(err){
        //         console.error("Failed to run less compiles it seems", arguments);
        //         cb(err, targetDirPath);
        //     }else{
        //         for(var lp in cssPerPath){
        //             var css = cssPerPath[lp];
        //             var cssPath = lp.substring(dirPath.length+1);
        //             cssPath = cssPath.substring(0, cssPath.lastIndexOf('.'));
        //             cssPath += '.css';
        //             var thePath = path.resolve(targetDirPath, cssPath);
        //             utils.writeFile(thePath, css.toString());
        //             console.log("Wrote " + lp + " to " + thePath);
        //         }
        //         console.log("Finished compiling to " + targetDirPath);
        //         prepareComponentDir(targetDirPath);
        //         cb(undefined, targetDirPath);
        //     }
        // });
    };

    this.buildPrototype = buildPrototype;
    const parseArgs = function (args) {
        runtime = args.runtime;
        project = args.project;
        composer = args.composer;
        targetDir = args.targetDir || runtime.getTargetDirPath();
        ignoreExcludeFromBuild = args.ignoreExcludeFromBuild || false;
    };
    parseArgs(args);
}

module.exports = {
    createBuilder: function (args) {
        return new Builder(args);
    }
};