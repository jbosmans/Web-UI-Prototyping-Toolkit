"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path"),
    // Promise = require("bluebird"),
    utils = require("./utils"),
    copier = require("./copier"),
    protostarBuilder = require("./protostarBuilder"),
    osTmpdir = require("os-tmpdir"),    //AdmZip = require("adm-zip"),
    lessCssSupport = require('./lessCssSupport'),    // lessCompiler = require("./lessCompiler"),
    zipUtils = require("./zipUtils");

const logger = utils.createLogger({sourceFilePath: __filename});

/*
 1. create a directory to hold the merged files
 2. copy all prototype sources into that dir
 3. build the prototype to a different dir and copy over the built files into the merge dir
 make sure the theme module dirs (dsvThemeShared etc) files are in sync with prototype
 4. remove the 'dav' dir - (it holds portal originating files in the prototype) replace the contents of the angularTheme-static/src/main/webapp/themes/angularTheme/angularApps/mydsv dir with the contents of the build dir
 make sure that any prereqs (eg js & css like angular modules etc) are configured as contributions and loaded in the right order so that the dependencies are present in portal
 ensure layouts & theme templates are up to date
 */



/*
 So this is the current flow and files when delivering for portlets:
 - The markup for that portlet (compiled from our .jade by Protostar) with a normal <link> to the css (to make it obvious for the dev.).
 Downside to this is the path will not be correct and needs to be changed by the dev.
 - The css for that portlet (compiled by whatever tool we have, like a webstorm plugin).
 Downside to this is we need to import the relevant bootstrap less files and our own mixins/variables in the less file (a convenience issue)
 - The JS for the portlet. No immediate downside (unless of course there are new theme js that needs to be added,
 which means we have to wait for this entire theme deployment cycle to be complete before we can test our new portlet).

 */


class PortalThemeMerger {
    constructor({targetDir, runtime, project, composer, projectPath, themePath}) {
        this.pathsToCopy = [];
        this.projectPath = projectPath;
        this.themePath = themePath;


        logger.debug("Parsing PortalThemeMerger instance arguments: ", arguments);
        /**
         *
         * @type {String}
         */
        this.targetDir = targetDir;
        /**
         * @type {ProtostarRuntime}
         */
        this.rt = runtime;
        /**
         * @type {Project}
         */
        this.prj = project;
        /**
         * @type {TemplateComposer}
         */
        this.cmp = composer;

        if(!this.rt) throw new Error("missing runtime arg");
        if(!this.prj) throw new Error("missing project arg");
        if(!this.cmp) throw new Error("missing composer arg");
    }

    mergeStatic() {
        this.prepareTargetStaticDirectory();
        const tmpDirPath = osTmpdir() + path.sep + ("_psMergeTemp_" + new Date().getTime());
        const targetBuildDirPath = tmpDirPath + path.sep + 'build';
        const targetMergeDirPath = tmpDirPath + path.sep + 'merge';
        copier.mkdirsSync(targetMergeDirPath);
        this.createBuiltByProtostarFile(targetMergeDirPath);
        const targetThemeDirPath = tmpDirPath + path.sep + 'theme';
        copier.mkdirsSync(targetThemeDirPath);
        console.log("Copying " + this.projectPath + " => " + targetMergeDirPath + " ...");
        if(!this.rt.isExistingDirPath(this.projectPath)){
            throw new Error("There is no prototype at path " + this.projectPath);
        }
        if(!this.rt.isExistingDirPath(this.targetDir)){
            throw new Error("There is no portal theme at path " + this.targetDir);
        }
        copier.copy(this.projectPath, targetMergeDirPath);
        return new Promise((resolve, reject) =>{
            const builder = protostarBuilder.createBuilder({
                runtime: this.rt,
                project: this.prj,
                composer: this.cmp,
                targetDir: targetBuildDirPath,
                ignoreExcludeFromBuild: false
            });
            builder.buildPrototype().done(() =>{
                console.log("copy " + targetBuildDirPath + " => " + targetMergeDirPath);
                copier.copy(targetBuildDirPath, targetMergeDirPath);
                console.log("copy " + this.targetDir + " => " + targetThemeDirPath);
                if(!this.rt.isExistingDirPath(targetThemeDirPath)){
                    fs.mkdirSync(targetThemeDirPath);
                }
                copier.copy(this.targetDir, targetThemeDirPath);
                console.info("Populating merge configuration (paths to copy) " + this.rt.projectConfigPath);
                this.pathsToCopy = this.populateMergePaths(this.rt.projectConfigPath, targetMergeDirPath, targetThemeDirPath);
                //console.log("copying the paths");
                this.copyThePaths(this.pathsToCopy);
                console.info("Copying collected and combined files from " + targetThemeDirPath + " back to " + this.targetDir +  " ...");
                copier.copy(targetThemeDirPath, this.targetDir);
                console.info("Finished pusing collected and combined files from " + targetThemeDirPath + " back to " + this.targetDir );
                console.info("Deleting temp dir " + tmpDirPath);
                copier.deleteRecursively(tmpDirPath);
                console.info("Static Merge finished successfully to " + this.targetDir);
                resolve();
            }, () =>{
                reject();
            });
        });
    }

    mergeProject() {
        this.prepareTargetDirectory();
        const targetBuildDirPath = this.targetDir + path.sep + 'build';
        const targetMergeDirPath = this.targetDir + path.sep + 'merge';
        copier.mkdirsSync(targetMergeDirPath);
        this.createBuiltByProtostarFile(targetMergeDirPath);
        const targetThemeDirPath = this.targetDir + path.sep + 'theme';
        copier.mkdirsSync(targetThemeDirPath);
        console.log("Copying " + this.projectPath + " => " + targetMergeDirPath + " ...");
        if(!this.rt.isExistingDirPath(this.projectPath)){
            throw new Error("There is no prototype at path " + this.projectPath);
        }
        copier.copy(this.projectPath, targetMergeDirPath);
        return new Promise((resolve, reject) =>{
            const builder = protostarBuilder.createBuilder({
                runtime: this.rt,
                project: this.prj,
                composer: this.cmp,
                targetDir: targetBuildDirPath,
                ignoreExcludeFromBuild: false
            });
            builder.buildPrototype().done(() =>{
                console.log("Copying build directory " + targetBuildDirPath + " to merge working directory " + targetMergeDirPath);
                copier.copy(targetBuildDirPath, targetMergeDirPath);
                console.log("Copying theme source dir " + this.themePath + " to  theme working directory " + targetThemeDirPath);
                if(!this.rt.isExistingDirPath(targetThemeDirPath)){
                    fs.mkdirSync(targetThemeDirPath);
                }
                copier.copy(this.themePath, targetThemeDirPath);
                const mergeConfigPath = targetMergeDirPath + path.sep + 'mergeThemeConfigWar.json';
                console.info("Populating merge paths from WAR mergeConfig at " + mergeConfigPath);
                this.pathsToCopy = this.populateMergePaths(mergeConfigPath, targetMergeDirPath, targetThemeDirPath);
                this.copyThePaths(this.pathsToCopy);
                const mergeConfig = this.readPrototypeMergeConfig(mergeConfigPath);
                if(mergeConfig.hasOwnProperty("packageAppDirsParents")){
                    const value = mergeConfig["packageAppDirsParents"];
                    let valueType = Object.prototype.toString.call(value);
                    valueType = valueType.substring(valueType.indexOf(' ')+1, valueType.length -1);
                    let cmpDirsArray = [];
                    if(valueType === 'Array' && value.length > 0){
                        cmpDirsArray = value.map(p => path.resolve(targetMergeDirPath, p));
                    }else if(valueType === 'String' && valueType.length > 0){
                        cmpDirsArray = [path.resolve(targetMergeDirPath, value)];
                    }else{
                        cmpDirsArray = [];
                    }
                    if(cmpDirsArray.length  >0){
                        this.createPackageZips(cmpDirsArray).done(() =>{
                            resolve();
                        });
                    }else{
                        resolve();
                    }
                }else{
                    console.info("Don't need to create self contained component dir zips");
                    resolve();
                }
            }, () =>{
                console.error("ERROR", arguments);
                reject();
            });
        });
    }

    emptyTargetDir() {
        const files = this.rt.listDir(this.targetDir);
        files.forEach(fileName =>{
            const filePath = path.resolve(this.targetDir,fileName);
            if (this.rt.isExistingDirPath(filePath)) {
                copier.deleteRecursively(filePath);
            } else {
                this.rt.deleteFile(filePath);
            }
        });
        logger.info("Emptied " + this.targetDir);
    }

    deleteCompiledCssFiles(cmpDir){
        copier
            .listDirChildrenFullPathsRecursively(cmpDir)
            .filter(filePath => filePath.indexOf('-') >0 && filePath.substring(filePath.lastIndexOf('-')) === '-compiled.css')
            .forEach(filePath =>{
                fs.unlinkSync(filePath);
        });
    }

    prepareComponentDir(cmpDir) {
        this.deleteCompiledCssFiles(cmpDir);
        const paths = copier.listDirChildrenFullPathsRecursively(cmpDir);
        const removedIdxs = [];
        const toRemove = [];
        const files = {
            html: [],
            css: [],
            js: []
        };
        const lessPaths = [];
        paths.forEach((filePath, idx) =>{
            const filenameExtension = path.extname(filePath);
            switch (filenameExtension){
                case '.less':
                    lessPaths.push(filePath);
                case '.jade':
                case '.scss':
                    fs.unlinkSync(filePath);
                    toRemove.push(filePath);
                    removedIdxs.push(idx);
                    break;
                case '.html':
                    files.html.push(filePath);
                    break;
                case '.js':
                    files.js.push(filePath);
                    break;
                case '.css':
                    files.css.push(filePath);
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
            html: this.makePathsRelativeToDirectory(files.html, cmpDir),
            js: this.makePathsRelativeToDirectory(files.js, cmpDir),
            css: this.makePathsRelativeToDirectory(files.css, cmpDir)
        };
        console.log("Relativized component files: ", relativeFiles);
        const allReferenceables = [].concat(relativeFiles.js).concat(relativeFiles.css);
        console.log("Checking for referenceables : ", allReferenceables);
        files.html.forEach(htmlPath =>{
            const html = utils.readTextFileSync(htmlPath);
            allReferenceables.forEach(refPath =>{
                try {
                    const query = refPath + '"';
                    const endIdx = html.indexOf(query);
                    if (endIdx > 0) {
                        const attrName = path.extname(refPath) === ".js" ? "src" : "href";
                        console.log("HTML " + htmlPath + " contains a ref that needs to be encoded to " + refPath);
                        const firstQuoteIdx = html.lastIndexOf('"', endIdx);
                        const closingQuote = html.indexOf('"', firstQuoteIdx + 1);
                        const toReplace = attrName + "=" + html.substring(firstQuoteIdx, closingQuote + 1);
                        const replacement = attrName + '="' + refPath + '"';
                        let outHtml = "" + html;
                        console.log("Replacing '" + toReplace + "' with '" + replacement + "'");
                        let lastCritIdx = outHtml.lastIndexOf(toReplace);
                        while (lastCritIdx >= 0) {
                            const before = outHtml.substring(0, lastCritIdx);
                            const after = outHtml.substring(lastCritIdx + toReplace.length);
                            outHtml = before + replacement + after;
                            lastCritIdx = outHtml.lastIndexOf(toReplace);
                        }
                        if (html !== outHtml) {
                            console.log("Saving modified html to" + htmlPath + " (for " + refPath + ")");
                            utils.writeFile(htmlPath, outHtml);
                        }
                    }
                } catch (e) {
                    console.error("Error during processing " + cmpDir, e);
                    throw e;
                }
            });
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
                    const scriptTag = '\n' + '<script type="text/javascript" src="' + firstJs + '"></script>' + '\n';
                    console.log("Adding script tag to " + htmlPath + " for " + firstJs);
                    cnt = cnt + scriptTag;
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

    populateMergePaths(mergeConfigPath, mergeDir, themeCopyDir) {
        const mp = [];
        if(this.rt.isExistingFilePath(mergeConfigPath)){
            const mergeConfig = this.readPrototypeMergeConfig(mergeConfigPath);
            Object.keys(mergeConfig["mergePaths"]).forEach((prototypePath) => {
                const themePath = mergeConfig["mergePaths"][prototypePath];
                console.log('Need to copy ' + prototypePath + ' -> ' + themePath);
                let sourcePath;
                if(prototypePath === '<root>'){
                    sourcePath = mergeDir;
                }else{
                    sourcePath = mergeDir + path.sep + prototypePath;
                }
                const targetPath = themeCopyDir + path.sep + themePath;
                mp.push({
                    source:sourcePath,
                    target:targetPath
                });
            });
            logger.debug("Populated merge paths: ", mp);
        }
        return mp;
    }

    isDirPath(filePath) {
        try{
            return fs.statSync(filePath).isDirectory();
        }catch(e){
            return false;
        }
    }

    createBuiltByProtostarFile(projectBuildPath) {
        let filePath = path.join(projectBuildPath, ".protostar-project-built");
        this.rt.writeFile(
            filePath,
            "This directory is created by building a Protostar prototype so can be overwritten by protostar."
        );
    }

    createPackageZips(cmpDirsArray) {
        return new Promise((resolve, reject) =>{
            this.compileAllLessFilesPromise(cmpDirsArray).done(() =>{
                console.log("Finished trying to compile all component less files in ", cmpDirsArray);
                cmpDirsArray.forEach((prjDirPath, idx) =>{
                    const prefix = cmpDirsArray.length > 1 ? "dir_" + (idx + 1) + "_" : "";
                    const cmpSourceDirPath = prjDirPath;
                    const appZipsDir = this.targetDir + path.sep + 'components';
                    copier.mkdirsSync(appZipsDir);
                    if(prefix){
                        this.packageSelfContainedComponentsDir(cmpSourceDirPath, appZipsDir, "dir_" + (idx+1) + "_");
                    }else{
                        this.packageSelfContainedComponentsDir(cmpSourceDirPath, appZipsDir);
                    }
                });
                console.log("Finished packaging component dirs");
                resolve();
            });
        });
    }

    /**
     *
     * @param {Array<string>} paths
     * @param {string} refDirPath
     * @return {Array<string>}
     */
    makePathsRelativeToDirectory(paths, refDirPath) {
        const out = [];
        let refDirPathWithSlash;
        if(refDirPath.charAt(refDirPath.length-1) !== '/'){
            refDirPathWithSlash = refDirPath + "/";
        }else{
            refDirPathWithSlash = refDirPath;
        }
        paths.forEach(p =>{
            if(p.indexOf(refDirPathWithSlash) === 0){
                out.push(p.substring(refDirPathWithSlash.length));
            }
        });
        return out;
    }

    targetDirExists() {
        return this.isDirPath(this.targetDir);
    }

    packageSelfContainedComponentsDir(sourceDirPath, targetComponentsDirPath, fnPrefix) {
        console.log("Creating component dirs below " + sourceDirPath + " to " + targetComponentsDirPath);
        if(!this.rt.isExistingDirPath(targetComponentsDirPath)){
            throw new Error("Path does not exist : " + targetComponentsDirPath);
        }
        const easyScriptPortletComponents = [];
        const children = fs.readdirSync(sourceDirPath);
        let cmpIdx = 0;
        children.forEach(dn =>{
            const childPath = path.resolve(sourceDirPath, dn);
            if(fs.statSync(childPath).isDirectory()){
                const workingDir = targetComponentsDirPath + path.sep + dn;
                cmpIdx += 1;
                const header = "\n\n" + cmpIdx + ". Component dir " + workingDir;
                console.info(header);
                console.info(utils.repeatChars('#', header.length)+"\n");
                try {
                    copier.copy(childPath, workingDir);
                    const easyScriptPortletReady = this.prepareComponentDir(workingDir);
                    if(easyScriptPortletReady){
                        easyScriptPortletComponents.push(dn + ".zip = " + workingDir);
                    }
                    let zipFileName = (typeof fnPrefix === 'string') ? fnPrefix : "";
                    zipFileName = zipFileName + dn + ".zip";
                    const targetZipPath = targetComponentsDirPath + path.sep + zipFileName;

                    zipUtils.zipDirectoryAs(workingDir, dn, targetZipPath);
                    console.log("Wrote component zip to " + targetZipPath+".\n");
                } catch (e) {
                    console.error("Could not prepare and create component zip for " + childPath, e);
                    console.error(e.stack);
                    throw e;
                }
            }
        });
        console.log("\nFinished component zip creation for "+cmpIdx+" components. \nFound easy script portlets: ", easyScriptPortletComponents);
    }

    prepareTargetStaticDirectory() {
        if(typeof this.targetDir !== 'string' || !this.targetDirExists()){
            throw new Error("Illegal targetDir: " + this.targetDir + ", it should exist (used as source as well)");
        }

    }

    copyThePaths(copyPaths) {
        logger.info("copying " + copyPaths.length + " paths: ", copyPaths);
        copyPaths.forEach(cp =>{
            copier.copy(cp.source, cp.target);
        });
    }

    readPrototypeMergeConfig(mergeConfigPath) {
        try {
            return JSON.parse(this.rt.readFile(mergeConfigPath));
        } catch (e) {
            e.message = "Could not read mergeConfig from " + mergeConfigPath;
            throw e;
        }
    }

    prototypeMergeConfigExists(mergeConfigPath) {
        return this.rt.isExistingFilePath(mergeConfigPath);
    }

    compileAllLessFilesPromise(cmpDirsParentDirPaths) {
        const lessPromises = [];
        cmpDirsParentDirPaths.forEach(cmpDirsParentDirPath =>{
            const lessPaths = copier.listDirChildrenFullPathsRecursively(cmpDirsParentDirPath).filter(p => path.extname(p) === '.less');

            function compileLessPromise(srcPath){
                return new Promise((resolve, reject) =>{
                    lessCssSupport.compile(lessCssSupport.createRequest(srcPath, path.dirname(srcPath))).then((result) => {
                        let baseName = srcPath.substring(0, srcPath.lastIndexOf('.')) + '.css';
                        console.log("Writing CSS for component " + baseName);
                        fs.writeFileSync(baseName, result.css.toString());
                        resolve();
                    }, (erss) =>{
                        console.error("Could not generate less for component " + srcPath, erss);
                        resolve();
                    });
                });
            }

            lessPaths.forEach(lessPath =>{
                lessPromises.push(compileLessPromise(lessPath));
            });
        });
        return Promise.all(lessPromises);
    }

    prepareTargetDirectory() {
        if(typeof this.targetDir !== 'string'){
            throw new Error("Illegal targetDir: " + this.targetDir);
        }
        if (this.targetDirExists()) {
            if(!this.rt.isExistingFilePath(path.join(this.targetDir, ".protostar-project-built"))){
                throw new Error("targetDir probably wasnt created by protostar (doesnt contain file .protostar-project-built) so refusing to delete/overwrite! " + this.targetDir);
            }
            this.emptyTargetDir();
            this.createBuiltByProtostarFile(this.targetDir);
        } else {
            logger.info("Created build target directory: " + this.targetDir);
            this.rt.mkdirs(this.targetDir);
            this.rt.writeFile(path.join(this.targetDir, ".protostar-project-built"), "This directory is created by building a Protostar prototype so can be overwritten by protostar.");
        }
    }

    mergeComponent(componentDirPath) {
        return new Promise((resolve, reject) =>{
            this.createPackageZips([componentDirPath]).done(() =>{
                console.log("Finished creating component packages for "+componentDirPath);
                resolve();
            });
        });
    }
}
module.exports = PortalThemeMerger;
// module.exports = {
//     merge:function(args){
//         const ptm = new PortalThemeMerger(args);
//         return ptm.mergeProject();
//     },
//     mergeStatic:function(args){
//         const ptm = new PortalThemeMerger(args);
//         return ptm.mergeStatic();
//     }
// };