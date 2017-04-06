"use strict";
const path = require("path");
const fs = require("./filesystem");
const jqueryRunner = require("./jqueryRunner");
const lessCssSupport = require('./lessCssSupport');
const jadeUtils = require("./jadeUtils");
const utils = require("./utils");
const sassCompiler = require("./sassCompiler");
const copier = require("./copier");
const logger = utils.createLogger({sourceFilePath: __filename});
const zipUtils = require("./zipUtils");
const osTmpdir = require("os-tmpdir");

class NewBuilder {
    constructor({runtime, project, composer, targetDir, ignoreExcludeFromBuild = false, cleanupCompiledHtml = false}) {
        this._runtime = runtime;
        this._project = project;
        this._composer = composer;
        this._targetDir = targetDir || runtime.getTargetDirPath();
        this._ignoreExcludeFromBuild = ignoreExcludeFromBuild;
        this.cleanupCompiledHtml = cleanupCompiledHtml;
        this.lessSourceCssTargets = {};
        this.sassSourceCssTargets = {};
        this.headerIdx = 0;
    }

    prepareTargetDirectory() {
        if (typeof this._targetDir !== 'string') {
            throw new Error("Illegal targetDir: " + this._targetDir);
        }
        if (this.targetDirExists()) {
            if (!this._runtime.isExistingFilePath(path.join(this._targetDir, ".protostar-project-built"))) {
                throw new Error("targetDir probably wasnt created by protostar (doesnt contain file .protostar-project-built) so refusing to delete/overwrite! " + this._targetDir);
            }
            this.emptyTargetDir();
            this._runtime.writeFile(path.join(this._targetDir, ".protostar-project-built"), "This directory is created by building a Protostar prototype so can be overwritten by protostar.");
        } else {
            logger.info("Creating build target directory: " + this._targetDir);
            this._runtime.mkdirs(this._targetDir);
            this._runtime.writeFile(path.join(this._targetDir, ".protostar-project-built"), "This directory is created by building a Protostar prototype so can be overwritten by protostar.");
        }
    }

    shouldIncludeNamedPathsInCompilation() {
        const projectConfig = this._runtime.readProjectConfig();
        let includeNamedPathsInCompilation = false;
        if (utils.nestedPathExists(projectConfig, "build", "includeNamedPaths") && utils.hasPropertyOfType(projectConfig.build, "includeNamedPaths", "Boolean")) {

            includeNamedPathsInCompilation = projectConfig.build.includeNamedPaths;
            logger.info("Include named paths in compilation? " + includeNamedPathsInCompilation);
        }
        return includeNamedPathsInCompilation;
    }

    determineExcludedPaths() {
        const projectConfig = this._runtime.readProjectConfig();
        const excludedPaths = [];
        if (utils.nestedPathExists(projectConfig, "build", "excludedPaths") && utils.hasPropertyOfType(projectConfig.build, "excludedPaths", "Array")) {
            projectConfig.build.excludedPaths.forEach((ep) => {
                let excludedPath;
                if (ep.indexOf("/") === 0) {
                    excludedPath = ep;
                } else {
                    excludedPath = path.normalize(this._runtime.constructProjectPath(ep));
                }
                logger.info("Excluding path from build: " + excludedPath);
                excludedPaths.push(excludedPath);
            });
        }
        return excludedPaths;
    }

    emptyTargetDir() {
        const files = this._runtime.listDir(this._targetDir);

        files.forEach((f) => {
            const fp = this._targetDir + "/" + f;
            if (this._runtime.isExistingDirPath(fp)) {
                copier.deleteRecursively(fp);
            } else {
                this._runtime.deleteFile(fp);
            }
        });
        logger.info("Emptied " + this._targetDir);
    }

    postProcessComposed(markup) {
        const self = this;
        return new Promise((resolve, reject) => {
            if (markup.content.trim().length > 1) {
                jqueryRunner.runJQuery(markup.content, $ =>{
                        jqueryRunner.assignUniqueIdsToEditables($);
                        jqueryRunner.removeMarkupIgnoredForBuild($);
                        jqueryRunner.processProtostarAttributes($, (attrName, attrVal) => self._runtime.determineProtostarAttributeValue(attrName, attrVal, self._targetDir));
                        $("*[data-editable]").attr("contenteditable", "false");
                        jqueryRunner.convertAbsoluteToTargetReferences($, self._targetDir);
                        let doctype = '<!doctype html>';
                        return $.html();
                    }
                    , (result, errors) =>{
                        if (errors) {
                            reject(errors);
                        } else {
                            resolve(result);
                        }
                    }, markup.metadata);
            } else {
                resolve(markup.content);
            }
        });
    }

    compileLess(sourcePath, targetPath) {
        const self = this;
        console.log("Compiling less " + sourcePath);
        return new Promise((resolve, reject) => {
            lessCssSupport.compile(lessCssSupport.createRequest(sourcePath, this._runtime.constructProjectPath(""))).then((c) => {
                logger.info("Compiled " + sourcePath);
                self.ensureWriteCss(targetPath, c.css, c.cssMap, c.dependencies);
                resolve();
            }, (error) => {
                logger.error("Error while compiling " + sourcePath, error.stack);
                reject(error);
            });
        });
    }

    compileSass(sourcePath, targetPath) {
        const self = this;
        console.log("Compiling sass " + sourcePath);
        return new Promise((resolve, reject) => {
            sassCompiler.renderSassPromise(this._runtime.readFile(sourcePath) + "", [path.dirname(sourcePath) + ""], path.basename(sourcePath)).then((css, cssmap, stats) =>{
                logger.info("Compiled " + sourcePath, stats);
                self.ensureWriteCss(targetPath, css, cssmap, stats);
                resolve();
            }, (error) => {
                console.error("Failed to compile sass " + sourcePath);
                reject(error);
            });
        });
    }

    ensureWriteCss(targetPath, css, sourceMap, deps) {
        copier.ensureParentDirExists(targetPath);
        logger.info("Writing css to " + targetPath);
        logger.debug("DEPS = ", deps);
        this._runtime.writeFile(targetPath, "" + css);
        if (targetPath.indexOf('.less') === (targetPath.length - 5)) {
            const dir = path.dirname(targetPath);
            let baseFileName = path.basename(targetPath);
            baseFileName = baseFileName.substring(0, baseFileName.lastIndexOf('.'));
            const basePath = dir + '/' + baseFileName;
            const cssPathForLess = basePath + ".css";
            this._runtime.writeFile(cssPathForLess, "" + css);
            const sourceMapPathForLess = basePath + ".css.map";
            this._runtime.writeFile(sourceMapPathForLess, "" + sourceMap);
            if (deps) {
                this._runtime.writeFile(basePath + ".deps.json", JSON.stringify(deps));
            }
        } else if (targetPath.indexOf('.css') === (targetPath.length - 4)) {
            const cssPath = targetPath;
            this._runtime.writeFile(cssPath, "" + css);
            const sourceMapPath = targetPath + ".map";
            this._runtime.writeFile(sourceMapPath, "" + sourceMap);
            if (deps) {
                this._runtime.writeFile(targetPath + ".deps.json", JSON.stringify(deps));
            }
        }

    }

    createConcatHtmlDocument(htmlDocumentMarkups) {
        let concat = "";
        htmlDocumentMarkups.forEach(doc =>{
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
    }

    createTargetPathForTemplate(templatePath) {
        return this._targetDir + this._runtime.createUrlPathForFile(templatePath);
    }

    copyDependencyDirs(absoluteTargetDepUrl, copiedDirPathsMap) {
        // return new Promise((resolve,reject) => {resolve()});
        if(absoluteTargetDepUrl.indexOf("http://") === 0 || absoluteTargetDepUrl.indexOf('https://') === 0 || absoluteTargetDepUrl === ''){
            console.info("Immediately resolving for " + absoluteTargetDepUrl);
            return new Promise((resolve) => {resolve()});
        }
        const self = this;
        return new Promise((resolve, reject) => {
            console.info("Copying " + absoluteTargetDepUrl + "...");
            try {
                let namedPathUrlPathname = this._runtime.namedPathsConfig.isNamedPathUrlPathname('/' + absoluteTargetDepUrl);
                if (!namedPathUrlPathname) {
                    const projEquivPath = this._runtime.constructProjectPath(absoluteTargetDepUrl.substring(this._targetDir.length + 1));
                    const lessEquiv = projEquivPath.substring(0, projEquivPath.lastIndexOf('.')) + ".less";
                    const sassEquiv = projEquivPath.substring(0, projEquivPath.lastIndexOf('.')) + ".sass";
                    const shouldCompileLess = projEquivPath.indexOf('.css') === (projEquivPath.length - 4) && !this._runtime.isExistingFilePath(projEquivPath) && this._runtime.isExistingFilePath(lessEquiv);
                    const shouldCompileSass = projEquivPath.indexOf('.css') === (projEquivPath.length - 4) && !this._runtime.isExistingFilePath(projEquivPath) && this._runtime.isExistingFilePath(sassEquiv);
                    if (shouldCompileLess) {
                        lessCssSupport.compile(lessCssSupport.createRequest(lessEquiv, this._runtime.constructProjectPath(""))).then((resolved) => {
                            this.ensureWriteCss(absoluteTargetDepUrl, resolved.css, resolved.cssMap, resolved.dependencies);
                            resolve();
                        }, (error) => {
                            console.error("Error while compiling lesscss " + lessEquiv, error);
                            reject(error);
                        });
                        return;// def.promise;
                    } else if (shouldCompileSass) {
                        sassCompiler.renderSass(this._runtime.readFile(sassEquiv) + "", [path.dirname(sassEquiv) + ""], path.basename(projEquivPath), (css, cssmap, stats) =>{
                            this.ensureWriteCss(absoluteTargetDepUrl, css, cssmap, stats);
                            resolve();
                        });
                        return;// def.promise;
                    }
                }

                let atdu = absoluteTargetDepUrl;

                if (absoluteTargetDepUrl.indexOf("://") > 0 || absoluteTargetDepUrl.indexOf("//") === 0) {
                    console.info("NOT copying external URL " + absoluteTargetDepUrl);
                    resolve();
                    return;//def.promise;
                }
                if (atdu.indexOf("ps:/") === 0) {
                    atdu = this._targetDir + atdu.substring(3);
                } else if (absoluteTargetDepUrl.indexOf("ps:") === 0) {
                    const npNameEndSlash = absoluteTargetDepUrl.indexOf('/', 4);
                    const npNamePotential = absoluteTargetDepUrl.substring(3, npNameEndSlash);
                    if (this._runtime.namedPathsConfig.isNamedPathName(npNamePotential)) {
                        atdu = this._targetDir + this._runtime.namedPathsConfig.getNamedPath(npNamePotential).url + absoluteTargetDepUrl.substring(npNameEndSlash);
                    } else {
                        console.error("Add handling for non-named-link non root ps: link attrs! " + absoluteTargetDepUrl);
                        // reject();
                        throw new Error("Add handling for non-named-link non root ps: link attrs! " + absoluteTargetDepUrl);
                        // return;
                    }

                } else if (atdu.indexOf('./') === 0 || atdu.indexOf('../') === 0) {
                    // throw new Error("TODO relative support : " + atdu);
                    throw new Error("TODO relative support : " + atdu);
                    // reject();
                    // return
                } else if (atdu.indexOf('/') !== 0) {
                    if (this._runtime.namedPathsConfig.isNamedPathName(atdu.substring(0, atdu.indexOf('/')))) {
                        atdu = this._targetDir + '/' + atdu;//.substring(atdu.indexOf('/')+1);
                    } else {
                        throw new Error("not handling RELATIVE URL : '" + atdu + "'");
                        // logger.warn("not handling RELATIVE URL : " + atdu);
                        // resolve();
                        // return;// def.promise;
                    }
                } else if (absoluteTargetDepUrl.indexOf(this._targetDir) !== 0) {
                    atdu = this._targetDir + absoluteTargetDepUrl;
                }

                if (atdu.indexOf(".less?compile") > 0) {
                    const urlPathname = atdu.substring(this._targetDir.length, atdu.length - 8);
                    const targetPath = atdu.substring(0, atdu.length - 8);
                    const sourceFilePath = this._runtime.findFileForUrlPathname(urlPathname);
                    if (!copiedDirPathsMap.hasOwnProperty(sourceFilePath)) {
                        copiedDirPathsMap[sourceFilePath] = targetPath;
                        lessCssSupport.compile(lessCssSupport.createRequest(sourceFilePath, this._runtime.constructProjectPath(""))).then((c) => {
                            const cssTargetPath = targetPath; //targetDir + "/ps/nm/" + u;
                            self.ensureWriteCss(cssTargetPath, c.css, c.cssMap, c.dependencies);
                            resolve();
                        }, (errors) => {
                            console.error("ERRORS ", errors);
                            reject(errors);
                        });
                        return;// def.promise;
                    } else {
                        resolve();
                        return;// def.promise;
                    }
                } else {
                    const copySource = this.createCopySourceFromTargetPath(atdu);
                    const copyTarget = this.createCopyTargetFromTargetPath(atdu);

                    if (!copiedDirPathsMap.hasOwnProperty(copySource) && copySource !== this._runtime.constructProjectPath(".")) {
                        copiedDirPathsMap[copySource] = copyTarget;
                        this.copyDep(copySource, copyTarget);
                    } else {
                        logger.debug("Already copied " + copySource + " -> " + copyTarget);
                    }
                    resolve();
                }
            } catch (e) {
                console.error("ERROR DURING COPY", e);
                reject(e);
            }

        });
    }


    createCopySourceFromTargetPath(absoluteTargetDepUrl) {
        let copySource;
        const atdu = absoluteTargetDepUrl;
        const td = this._targetDir;
        const withoutTargetDir = atdu.substring(td.length);
        const bowerTargetPrefix = (td + "/ps/ext/");
        const nodeTargetPrefix = (td + "/ps/nm/");
        const internalDepTargetPrefix = td + "/ps/";
        if (atdu.indexOf(bowerTargetPrefix) === 0) {
            const bowerDepName = atdu.substring(bowerTargetPrefix.length, atdu.indexOf('/', bowerTargetPrefix.length));
            copySource = this._runtime.constructAppPath(['bower_components', bowerDepName]);
        } else if (atdu.indexOf(nodeTargetPrefix) === 0) {
            const nodeDepName = atdu.substring(nodeTargetPrefix.length, atdu.indexOf('/', nodeTargetPrefix.length));
            copySource = this._runtime.constructAppPath(['node_modules', nodeDepName]);
        } else if (atdu.indexOf(internalDepTargetPrefix) === 0) {
            const internalDepDirname = atdu.substring(internalDepTargetPrefix.length, atdu.indexOf('/', internalDepTargetPrefix.length));
            copySource = this._runtime.constructAppPath(['core', internalDepDirname]);

        } else if (atdu.indexOf(td + "/ps/dynamic/") === 0) {
            throw new Error("todo: build dynamic resources: " + atdu);
        } else if (this._runtime.namedPathsConfig.isNamedPathUrlPathname(withoutTargetDir)) {
            const npName = this._runtime.namedPathsConfig.resolveUrlPathnameToNamedPathName(withoutTargetDir);
            const np = this._runtime.namedPathsConfig.getNamedPath(npName);
            copySource = np.path;
        } else if (this._runtime.isProjectFileUrlPathname(withoutTargetDir)) {
            let projectSource;
            const secondSlash = withoutTargetDir.indexOf('/', 1);
            let projectChild;
            if (secondSlash > 0) {
                projectChild = path.dirname(withoutTargetDir).substring(1);//withoutTargetDir.substring(1, secondSlash);
            } else {
                projectChild = withoutTargetDir.substring(1);
            }
            projectSource = this._runtime.constructProjectPath(projectChild);
            copySource = projectSource;
        } else {
            throw new Error("Uncategorized source file target url path : " + atdu);
        }
        return copySource;
    }

    createCopyTargetFromTargetPath(absoluteTargetDepUrl) {
        let copyTarget;
        const atdu = absoluteTargetDepUrl;
        const td = this._targetDir;
        const withoutTargetDir = atdu.substring(td.length);
        const bowerTargetPrefix = (td + "/ps/ext/");
        const nodeTargetPrefix = (td + "/ps/nm/");
        const internalDepTargetPrefix = td + "/ps/";
        if (atdu.indexOf(bowerTargetPrefix) === 0) {
            const bowerDepName = atdu.substring(bowerTargetPrefix.length, atdu.indexOf('/', bowerTargetPrefix.length));
            copyTarget = bowerTargetPrefix + bowerDepName;
        } else if (atdu.indexOf(nodeTargetPrefix) === 0) {
            const nodeDepName = atdu.substring(nodeTargetPrefix.length, atdu.indexOf('/', nodeTargetPrefix.length));
            copyTarget = nodeTargetPrefix + nodeDepName;
        } else if (atdu.indexOf(internalDepTargetPrefix) === 0) {
            const internalDepDirname = atdu.substring(internalDepTargetPrefix.length, atdu.indexOf('/', internalDepTargetPrefix.length));
            copyTarget = internalDepTargetPrefix + internalDepDirname;
        } else if (atdu.indexOf(td + "/ps/dynamic/") === 0) {
            throw new Error("todo: build dynamic resources: " + atdu);
        } else if (this._runtime.namedPathsConfig.isNamedPathUrlPathname(withoutTargetDir)) {
            const npName = this._runtime.namedPathsConfig.resolveUrlPathnameToNamedPathName(withoutTargetDir);
            const np = this._runtime.namedPathsConfig.getNamedPath(npName);
            copyTarget = td + np.url;
        } else if (this._runtime.isProjectFileUrlPathname(withoutTargetDir)) {
            const secondSlash = withoutTargetDir.indexOf('/', 1);

            let projectChild;
            if (secondSlash > 0) {
                projectChild = path.dirname(withoutTargetDir);
            } else {
                projectChild = withoutTargetDir;
            }
            copyTarget = td + projectChild;
        } else {
            throw new Error("Uncategorized source file target url path : " + atdu);
        }
        return copyTarget;
    }

    gatherDependencies(compiledTemplates){
        return new Promise((resolve,reject) => {
            const outFiles = [];
            for (let tp in compiledTemplates) {
                const ct = compiledTemplates[tp];
                outFiles.push(ct);
                const targetFilePath = this.createTargetPathForTemplate(ct.path);//"/" + ct.name;
                this._runtime.mkdirs(path.dirname(targetFilePath));
            }
            const markups = [];
            outFiles.forEach(of =>{
                markups.push(of.compiled);
            });
            const concat = this.createConcatHtmlDocument(markups);
            jqueryRunner.runJQuery(concat, $ =>{
                const config = {
                    script: "src",
                    link: "href",
                    img: "src"
                };
                return jqueryRunner.collectReferenceAttributeValues($, config);
            }, result =>{
                console.info("Found unique dependency links in pages : ", result);
                resolve(result);
            });
        });
    }

    afterPostProcessing(compiledTemplates, callBack) {
        const outFiles = [];
        for (let tp in compiledTemplates) {
            const ct = compiledTemplates[tp];
            outFiles.push(ct);
            const targetFilePath = this.createTargetPathForTemplate(ct.path);//"/" + ct.name;
            this._runtime.mkdirs(path.dirname(targetFilePath));
        }
        const markups = [];
        outFiles.forEach(of =>{
            markups.push(of.compiled);
        });
        const concat = this.createConcatHtmlDocument(markups);

        this.gatherDependencies(compiledTemplates).then((result) => {
            console.info("Found unique dependency links in pages : ", result);

            const out = result;
            if (!fs.existsSync(this._targetDir + "/ps"))
                this._runtime.mkdir(this._targetDir + "/ps");
            if (!fs.existsSync(this._targetDir + "/ps/ext"))
                this._runtime.mkdir(this._targetDir + "/ps/ext");
            if (!fs.existsSync(this._targetDir + "/ps/assets"))
                this._runtime.mkdir(this._targetDir + "/ps/assets");
            if (!fs.existsSync(this._targetDir + "/ps/nm"))
                this._runtime.mkdir(this._targetDir + "/ps/nm");
            this.copyProjectDependencies();
            const copiedMap = {};
            const promises = [];
            const targets = [];
            for (let scriptDepUrl in out.script) {
                console.log("COPY script " + scriptDepUrl);
                promises.push(this.copyDependencyDirs(scriptDepUrl, copiedMap));
                targets.push(scriptDepUrl);
            }
            //var cssPromises = [];
            for (let linkDepUrl in out.link) {
                console.log("COPY link " + linkDepUrl);
                promises.push(this.copyDependencyDirs(linkDepUrl, copiedMap));
                targets.push(linkDepUrl);
            }
            for (let imgDepUrl in out.img) {
                if(imgDepUrl.indexOf("localhost:8888") < 0){
                    console.log("COPY img " + imgDepUrl)
                    promises.push(this.copyDependencyDirs(imgDepUrl, copiedMap));
                    targets.push(imgDepUrl);
                }
            }

            for (let queuedLess in this.lessSourceCssTargets) {
                console.log("COPY less " + queuedLess)
                promises.push(this.compileLess(queuedLess, this.lessSourceCssTargets[queuedLess]));
                targets.push(queuedLess);
            }
            for (let queuedSass in this.sassSourceCssTargets) {
                console.log("COPY sass " + queuedSass)
                promises.push(this.compileSass(queuedSass, this.sassSourceCssTargets[queuedSass]));
                targets.push(queuedSass);
            }
            console.log("invoking promises for targets : ", targets);
            Promise.all(promises)
                .then((copied) => {
                    console.info("All copies are done ! ", copied);
                    this.makeBuildRelative(compiledTemplates, () =>{
                        this.compileThemes(callBack);
                    });
                }, (err) => {
                    console.error("We have failed copies ", err);
                });

        }, (err) => {
            console.error("We have failed copies ", err);
            console.trace("errors");
        }).catch((err) => {
            console.error("Promise erors", err);
        });
    }

    compileTheme(themeName, entryPoint, projectConfig) {
        console.log("Creating promise for " + themeName);
        const self = this;
        return new Promise((resolve, reject) => {
            console.log("Compiling theme " + themeName + " for entry point " + entryPoint);
            lessCssSupport.compile(lessCssSupport.createRequest(entryPoint, self._runtime.constructProjectPath(""), {
                globalVars: {themeName: themeName},
                modifyVars: {themeName: themeName}
            })).then((c) => {
                console.log("FInished : " + themeName);
                const cssTargetPath = self._targetDir + "/" + projectConfig.theming.entryPoint; //targetDir + "/ps/nm/" + u;
                self.ensureWriteCss(cssTargetPath + "-" + themeName + ".css", c.css, c.cssMap, c.dependencies);
                resolve();
            }, (error) => {
                logger.error("LESS compilation error", error.stack);
                reject(error);
            });
        });
    }

    compileThemes(callBack) {
        const self = this;
        console.log("COMPILE THEMEZ")

        const projectConfig = self._runtime.readProjectConfig();
        if (!(utils.nestedPathExists(projectConfig, "theming", "enabled") && typeof projectConfig.theming.enabled === 'boolean' && projectConfig.theming.enabled)) {
            logger.info("Theming not enabled for project");
            callBack();
            return;
        }
        const entryPoint = self._project.resolveProjectFile(projectConfig.theming.entryPoint);
        const themeNames = projectConfig.theming.themeNames;
        const defaultThemeName = projectConfig.theming.defaultThemeName;
        let themeNameVar = projectConfig.theming.themeNameVar;
        const compileThemes = projectConfig.theming.compileThemes;
        let compileDefaultThemeOnly = projectConfig.theming.compileDefaultThemeOnly;
        logger.info("DEFAULT THEME NAME = " + defaultThemeName);
        logger.info("ENTRY POINT = " + entryPoint);

        const promises = themeNames.map(themeName => this.compileTheme(themeName, entryPoint, projectConfig));
        Promise.all(promises).then(() => {
            logger.info("AFinished compiling themes");
            callBack();
        }, (err) => {
            logger.error("Failures during theme compilation", err);
            debugger;
            callBack();
        });
    }

    postProcessComposedForRelative(markup) {
        const self = this;

        return new Promise((resolve,reject) => {
            if (markup.content.trim().length > 1) {
                jqueryRunner.runJQuery(markup.content, ($, window, metadata) =>{
                        try {
                            jqueryRunner.assignUniqueIdsToEditables($);
                            if (!self._ignoreExcludeFromBuild) {
                                jqueryRunner.removeMarkupIgnoredForBuild($);
                            }
                            jqueryRunner.processProtostarAttributes($, (attrName, attrVal) => self._runtime.determineProtostarAttributeValue(attrName, attrVal, self._targetDir));
                            $("*[data-editable]").attr("contenteditable", "false");
                            jqueryRunner.convertAbsoluteToTargetReferences($, self._targetDir);
                            metadata.templateTargetPath = self.createTargetPathForTemplate(metadata.templatePath);
                            metadata.targetDir = self._targetDir;
                            jqueryRunner.createPageRelativeReferences($, self._targetDir, metadata);
                            let doctype = '<!doctype html>';
                            return /*doctype + '\n' +*/ $.html();
                        } catch (jqfe) {
                            logger.error("Error while running modifyBuiltMarkupToRelativeWithJQuery", jqfe.stack);
                            throw jqfe;
                        }
                    }
                    , (result, errors) =>{
                        if (errors) {
                            reject(errors);
                        } else {
                            resolve(result);
                        }
                    }, markup.metadata);
            } else {
                resolve(markup.content);
            }
        });
    }

    makeBuildRelative(compiledTemplates, callBack) {
        const allTemplatePaths = Object.keys(compiledTemplates);
        logger.debug("TEMPLATE PATHS FOR RELATIVE : ", allTemplatePaths);
        const self = this;
        const relativizeCompiledTemplate = templatePath => new Promise((resolve, reject) => {
            const ct = compiledTemplates[templatePath];
            self.postProcessComposedForRelative(ct.pageContentsCompiled).then(contentsPostProcessedRelative => {
                resolve({
                    path: templatePath,
                    compiled: contentsPostProcessedRelative
                });
            }, errors => {
                logger.error("making build relative threw errors!", errors.stack);
                reject(errors);

            });
        });
        Promise.all(allTemplatePaths.map((tp) => relativizeCompiledTemplate(tp))).then((data) => {
            logger.debug("Finished relativizing : ", data);
            self.finalRun(data, callBack);
        }, (errors) => {
            logger.error("Failed to relativize: ", errors.stack);
            callBack();
        });
    }

    finalRun(compiledTemplates, callBack) {
        const outFiles = [];
        let written = 0;
        for (let tp in compiledTemplates) {

            const ct = compiledTemplates[tp];

            outFiles.push(ct);

            const targetFilePath = this.createTargetPathForTemplate(ct.path);//"/" + ct.name;

            console.info("Compiling page " + (written + 1) + ": " + targetFilePath);

            this._runtime.mkdirs(path.dirname(targetFilePath));

            logger.debug("Writing file to " + targetFilePath);
            if (this.cleanupCompiledHtml) {
                logger.debug("Removing comments from " + path.basename(targetFilePath));
                const removedComments = utils.removeAllHtmlComments(ct.compiled);
                logger.debug("Beautifying " + path.basename(targetFilePath));
                const beautified = utils.beautifyHtml(removedComments).replace(/^\s*[\r\n]/gm, "");
                this._runtime.writeFile(targetFilePath, beautified);
            } else {
                this._runtime.writeFile(targetFilePath, ct.compiled);
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
    }

    copyDep(source, target) {
        if (source === this._runtime.constructProjectPath("")) {
            throw new Error("Trying to copy project dir to " + target);
        }

        if (source.indexOf(this._targetDir) === 0) {
            throw new Error("Trying to copy from targetDir !" + source);
        }
        logger.debug("Copy " + source + " => " + target);
        if (!this._runtime.isExistingPath(source)) {

            const lessPath = source.substring(0, source.lastIndexOf('.')) + '.less';
            const sassPath = source.substring(0, source.lastIndexOf('.')) + '.scss';

            if (path.extname(source) === '.css' && this._runtime.isExistingPath(lessPath)) {

                this.lessSourceCssTargets[lessPath] = target;
                logger.info("Queued less compilation: ", this.lessSourceCssTargets);

                return;
            } else if (path.extname(source) === '.css' && this._runtime.isExistingPath(sassPath)) {

                this.sassSourceCssTargets[sassPath] = target;
                logger.info("Queued sass compilation: ", this.sassSourceCssTargets);

                return;
            } else {
                logger.error("NON EXISTING: " + source);
                throw new Error("Non existing path! " + source);
            }
        }
        copier.ensureParentDirExists(target);
        if (this._runtime.isExistingFilePath(source)) {
            logger.debug("Copying FILE " + source + " => " + target);
            this._runtime.writeFile(target, this._runtime.readFile(source) + "");
        } else {
            logger.debug("Copying DIR " + source + " => " + target);
            copier.copy(source, target);
        }
    }

    copyProjectDependencies() {
        const projectConfig = this._runtime.readProjectConfig();
        const self = this;
        if (utils.nestedPathExists(projectConfig, "build", "resourceDirs", "project") && utils.getObjectType(projectConfig.build.resourceDirs.project) === 'Array') {
            projectConfig.build.resourceDirs.project.forEach(projPath =>{
                self.copyDep(self._runtime.constructProjectPath(projPath), self._targetDir + "/" + projPath);
            });
        } else {
            logger.warn("No resourceDirs defined in prototype.json at build.resourceDirs");
        }
        console.info("Finished copy project deps");
    }

    targetDirExists() {
        let exists = false;
        if (this._runtime.isExistingPath(this._targetDir)) {
            if (this._runtime.isExistingDirPath(this._targetDir)) {
                exists = true;
            } else {
                throw new Error("Build targetDir path exists but it's no directory: " + this._targetDir);
            }
        }
        return exists;
    }

    logHeaderIndexed(heading) {
        this.headerIdx++;
        const msg = "" + this.headerIdx + ". " + heading;
        console.log("\n\n" + msg);
        let line = '';
        for (let l = 0; l < msg.length + 3; l++) {
            line += '#';
        }
        console.log(line + "\n\n");
    }

    compileTemplate(pagePath, pageContents) {
        console.log("COMPILEZOR : " + pagePath);
        const self = this;
        return new Promise((resolve, reject) => {
            const pageContentsCompiled = self._composer.composeTemplate(pagePath, pageContents);
            logger.info("Compiled for build: " + pagePath + " with metadata:", pageContentsCompiled.metadata);
            self.postProcessComposed(pageContentsCompiled).then(pageContentsPostProcessed =>{
                console.log("Postprocessed " + pagePath);
                let compiledPage = {
                    name: pagePath,
                    path: pagePath,
                    compiled: pageContentsPostProcessed,
                    pageContents: pageContents,
                    pageContentsCompiled: pageContentsCompiled,
                    pageContentsPostProcessed: pageContentsPostProcessed
                };
                resolve(compiledPage);
            }, errors =>{
                logger.info("Errors :: ", errors.stack);
                reject(errors);
            });
        });

    }

    listPagesToCompile(templates){
        const projectConfig = this._runtime.readProjectConfig();
        const includeNamedPathsInCompilation = this.shouldIncludeNamedPathsInCompilation(projectConfig);
        const excludedPaths = this.determineExcludedPaths(projectConfig);
        const pagesToCompile = templates.filter((pagePath) => {
            let includePage = true;
            excludedPaths.forEach(ep =>{
                if (pagePath.indexOf(ep) === 0) {
                    includePage = false;
                }
            });
            if (!includePage) {
                logger.info("Not compiling page below excluded path : " + pagePath);
                return false;
            }

            let namedPathChild = includeNamedPathsInCompilation && this._runtime.namedPathsConfig.isNamedPathChild(pagePath);

            if (namedPathChild) {
                logger.info("Not compiling page below a named path: " + pagePath);
                return false;
            }
            // let compile = includePage && (includeNamedPathsInCompilation || !self._runtime.namedPathsConfig.isNamedPathChild(pagePath));
            const pageContents = this._runtime.readFile(pagePath);
            let doesntContainsJekyllMarkup = pageContents.indexOf('{%') < 0 && pageContents.indexOf('%}')
            if (!doesntContainsJekyllMarkup) {
                logger.info("Not compiling Jekyll page: " + pagePath);
            }
            return doesntContainsJekyllMarkup;

        });
        return pagesToCompile;
    }
    compileTemplates(pagesToCompile){
        console.info("Pages to compile : ", pagesToCompile);
        let promises = pagesToCompile.map((p) => {
            return this.compileTemplate(p, this._runtime.readFile(p))
        });
        console.log("the promises = ", promises);
        return Promise.all(promises);
    }

    buildPrototype() {
        const self = this;

        return new Promise((resolve, reject) => {
            self.logHeaderIndexed("Updating dynamic (discover templates etc)");
            self._project.updateDynamic();
            const jadeTemplates = self._project.listProjectJadeTemplatePaths();
            self.logHeaderIndexed("Preprocessing " + jadeTemplates.length + " JADE template paths");
            logger.info("Found " + jadeTemplates.length + " JADE templates. Compiling ...");
            jadeTemplates.forEach(jt =>{
                logger.debug("Compiling JADE template found: " + jt);
                const result = jadeUtils.jadeFileToHtmlFile(jt);
                logger.debug("Compiled JADE to HTML first : " + result.path);
            });
            logger.info("Compiled " + jadeTemplates.length + " JADE templates.");

            self.prepareTargetDirectory();
            const templates = self._project.listAllTemplatePaths();
            const compiledTemplates = {};
            const pagesToCompile = self.listPagesToCompile(templates);
            this.compileTemplates(pagesToCompile).then((compiled) => {
                console.info("Finished compiling " + compiled.length + " templates");
                compiled.forEach((c) => {
                    compiledTemplates[c.path] = c;
                });
                this.afterPostProcessing(compiledTemplates, () =>{
                    const jtp = self._project.listProjectJadeTemplatePaths();
                    let deleted = jadeUtils.deleteCompiledFilesForTemplates(jtp);
                    resolve(compiledTemplates);
                });
            }, (err) => {
                logger.error("Errors while compiling templates: ", err);
                reject();
            });
        });
    }

    createZipBuild() {
        return new Promise((resolve, reject) => {
            const dirName = path.basename(this._targetDir);
            this.buildPrototype().then( () =>{
                if (!this._targetDir) throw new Error("Illegal target dir");
                const zipPath = osTmpdir() + path.sep + 'built_' + dirName + '_' + new Date().getTime() + '.zip';
                zipUtils.zipDirectoryAs(this._targetDir, dirName, zipPath);
                // callback(zipPath, this._targetDir, dirName);
                console.info("SUCCESS : built ZIP to " + zipPath);
                resolve(zipPath, this._targetDir, dirName)
            }, (errors) => {
                logger.error("create zip build errors", errors);
                reject(errors);
            });
        });

    }

    buildComponentDirs(dirPaths, targetDirPath, cb) {
        if (fs.existsSync(targetDirPath)) {
            throw new Error("targetDirPath should not yet exist :" + targetDirPath);
        }
        if (!fs.existsSync(path.dirname(targetDirPath))) {
            throw new Error("cannot create target dir below non existing dir : " + targetDirPath);
        }
        fs.mkdirSync(targetDirPath);
        const self = this;

        function buildSubDir(lp) {
            return new Promise((resolve, reject) => {
                const ntd = path.resolve(targetDirPath, path.basename(lp));
                self.buildComponentDir(lp, ntd, (err, builtToDir) =>{
                    if (err) {
                        resolve({
                            ok: false,
                            error: err,
                            target: ntd,
                            dir: lp
                        });
                    } else {
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
        dirPaths.forEach(lp =>{
            buildPromises.push(buildSubDir(lp));
        });
        Promise.all(buildPromises).then(results =>{
            console.log("Finished building " + dirPaths.length + " component dirs to " + targetDirPath);
            for (let i = 0; i < dirPaths.length; i++) {
                const res = results[i];
                if (res.ok) {
                    console.info("Built component dir for : ", res);
                } else {
                    console.error("Could not build component dir for : ", res);
                }
            }
            cb(undefined, targetDirPath, results);
        }, err =>{
            console.error("Failed to run less compiles it seems", err);
            cb(err);
        }).catch(err =>{
            console.error("Caught error during less compiles it seems", err.stack);
            cb(err);
        });

    }

    buildComponentDir(dirPath, targetDirPath, cb) {
        const self = this;
        if (dirPath.indexOf(this._project.runtime.projectDirPath) !== 0) {
            throw new Error("Dirpath must be a subdir of the project dir: " + dirPath);
        }
        const componentFiles = copier.listDirChildrenFullPathsRecursively(dirPath);
        if (fs.existsSync(targetDirPath)) {
            throw new Error("targetDirPath should not yet exist :" + targetDirPath);
        }
        if (!fs.existsSync(path.dirname(targetDirPath))) {
            throw new Error("cannot create target dir below non existing dir : " + targetDirPath);
        }
        fs.mkdirSync(targetDirPath);
        copier.copy(dirPath, targetDirPath);
        const htmlFiles = componentFiles.filter(p => path.extname(p) === '.html');
        const jadeFiles = componentFiles.filter(p => path.extname(p) === '.jade');
        const lessFiles = componentFiles.filter(p => path.extname(p) === '.less');
        jadeFiles.forEach(f =>{
            const compiledData = jadeUtils.jadeFileToHtmlFile(f);
            const htmlPath = compiledData.path;
            htmlFiles.push(htmlPath);
        });
        copier.copy(dirPath, targetDirPath);
        htmlFiles.forEach((f)=> {
            const compiledData = this._project.composer.composeTemplate(f, utils.readTextFileSync(f), 100);
            utils.writeFile(path.resolve(targetDirPath, f.substring(dirPath.length + 1)), compiledData.content.replace(/contenteditable="true"/g, ""));
        });

        lessCssSupport.compileFiles(lessFiles.map((f) => {
            return lessCssSupport.createRequest(f, path.dirname(f))
        })).then((results) => {
            results.forEach((r) => {
                let lp = r.request.sourceFile;
                let css = r.css;
                let cssPath = lp.substring(dirPath.length + 1);
                cssPath = cssPath.substring(0, cssPath.lastIndexOf('.'));
                cssPath += '.css';
                const thePath = path.resolve(targetDirPath, cssPath);
                utils.writeFile(thePath, css.toString());
                console.log("Wrote " + lp + " to " + thePath);
            });
            console.log("Finished compiling to " + targetDirPath);
            self.prepareComponentDir(targetDirPath);
            cb(undefined, targetDirPath);
        }, (err) => {
            console.error("Failed to run less compiles it seems", arguments);
            cb(err, targetDirPath);
        });
    }

    prepareComponentDir(cmpDir) {
        //var that = this;
        copier.listDirChildrenFullPathsRecursively(cmpDir).forEach(p =>{
            if (p.indexOf('-') > 0 && p.substring(p.lastIndexOf('-')) === '-compiled.css') {
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
        paths.forEach((p, idx) =>{
            const ext = path.extname(p);
            switch (ext) {
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
        removedIdxs.forEach(idx =>{
            paths.splice(idx, 1);
        });

        const relativeFiles = {
            html: utils.relativize(files.html, cmpDir),
            js: utils.relativize(files.js, cmpDir),
            css: utils.relativize(files.css, cmpDir)
        };
        console.log("Relativized component files: ", relativeFiles);
        const allReferenceables = ([].concat(relativeFiles.js).concat(relativeFiles.css)).map(r => r.replace(/\\/g, '/'));
        console.log("Checking for referenceables : ", allReferenceables);
        files.html.forEach(htmlPath =>{
            allReferenceables.forEach(refPath =>{
                let html = utils.readTextFileSync(htmlPath);
                html = html.replace(/contenteditable="true"/, "");
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
                        if (toReplace !== replacement) {
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
            if (surroundAsFullHtmlDocForScriptPortlet) {
                const newTxt = '<html><head></head><body>' + fs.readFileSync(htmlPath, 'utf8') + '</body></html>';
                fs.writeFileSync(htmlPath, newTxt, 'utf8');
            }
        });
        const easy = relativeFiles.html.length === 1 && relativeFiles.js.length <= 1 && relativeFiles.css.length <= 1;
        if (easy) {
            const htmlPath = files.html[0];
            let cnt = "";
            let read = false;
            let initCnt = "";
            if (relativeFiles.js.length === 1) {
                cnt = utils.readTextFileSync(htmlPath);
                initCnt = "" + cnt;
                read = true;
                const firstJs = relativeFiles.js[0];
                if (cnt.indexOf(firstJs + '"') < 0) {
                    const src = firstJs;
                    const scriptTag = '\n' + '<script type="text/javascript" src="' + src + '"></script>' + '\n';
                    console.log("Adding script tag to " + htmlPath + " for " + firstJs);
                    cnt += scriptTag;
                }
            }
            if (relativeFiles.css.length === 1) {
                if (!read) {
                    cnt = utils.readTextFileSync(htmlPath);
                    initCnt = "" + cnt;
                }
                const firstCss = relativeFiles.css[0];
                if (cnt.indexOf(firstCss + '"') < 0) {
                    const linktag = '<link rel="stylesheet" href="' + firstCss + '"/>';
                    cnt = '\n' + linktag + '\n' + cnt;
                    console.log("Adding css link tag to " + htmlPath + " for " + firstCss);
                }
            }
            if (read && (cnt.length > 0 && (initCnt !== cnt))) {
                utils.writeFile(htmlPath, cnt);
            }
            logger.info("Prepared an easy portlet: " + cmpDir);
        } else {
            logger.info("Not an easy portlet: " + cmpDir + ": ", relativeFiles);
        }
        return easy;
    }
}

module.exports = NewBuilder;