"use strict";
const path = require("path");
const fs = require('fs');
const utils = require("./utils");
const exec = require("child_process").exec;

const logger = utils.createLogger({sourceFilePath: __filename});

class BowerUtils {
    constructor(projectDir) {
        this.projectDir = projectDir;
    }

    /**
     * @return {boolean}
     */
    isBowerJsonProvided() {
        return fs.existsSync(this.getBowerJsonPath());
    }

    /**
     * @return {boolean}
     */
    isBowerRcProvided() {
        return fs.existsSync(this.getBowerRcPath());
    }

    /**
     * @return {String}
     */
    getBowerRcPath() {
        return this.projectDir + path.sep + ".bowerrc";
    }

    /**
     * @return {String}
     */
    getBowerJsonPath() {
        return this.projectDir + path.sep + "bower.json";
    }

    /**
     * @return {String}
     */
    getBowerDirectoryPath() {
        let bdn = "bower_components";
        if (this.isBowerRcProvided()) {
            const bowerRc = this.readBowerRc();
            if (bowerRc.hasOwnProperty("directory")) {
                bdn = bowerRc.directory;
            }

        }
        return this.projectDir + path.sep + bdn;
    }

    readBowerRc() {
        return JSON.parse(fs.readFileSync(this.getBowerRcPath(), 'utf8'));
    }

    readBowerJson() {
        return JSON.parse(fs.readFileSync(this.getBowerJsonPath(), 'utf8'));
    }

    compareJsonDepsWithInstalled(bowerDirPath) {
        return new Promise((resolve, reject) => {
            if (!fs.existsSync(bowerDirPath)) {
                resolve(true);
            } else {
                let bowerDepDirNames = fs.readdirSync(bowerDirPath);
                const parsedBower = this.readBowerJson();
                let needed = false;
                const firstLevelDeps = [];
                Object.keys(parsedBower.dependencies).forEach(dep =>{
                    firstLevelDeps.push(dep);
                    if(bowerDepDirNames.indexOf(dep) <0){
                        logger.info("Missing bower dependency " + dep + "#" + parsedBower.dependencies[dep] + " => bower install needed");
                        needed = true;
                    }
                });
                resolve(needed);
            }
        });
    }


    isBowerInstallNecessary() {
        return new Promise((resolve, reject) => {
            if(this.isBowerJsonProvided()){
                let bowerDirPath = this.getBowerDirectoryPath();
                return this.compareJsonDepsWithInstalled(bowerDirPath).then((needed) => {
                    resolve(needed);
                });
            }else{
                resolve(false);
            }
        });
    }

    invokeBower(bowerExecPath, nodeCommandPath, workingDirPath){
        return new Promise((resolve, reject) => {
            let bowerExec = bowerExecPath;
            if (bowerExec.indexOf(" ") > 0) {
                bowerExec = '"' + bowerExec + '"';
            }
            const cmd = nodeCommandPath + " " + bowerExec + " install";
            logger.info("Running bower : " + cmd);
            exec(cmd, {
                cwd: workingDirPath
            }, (error, stdout, stderr) =>{
                if (error) {
                    logger.error("Bower STDOUT=", stdout);
                    logger.error("Bower STDERR=", stderr);
                    logger.error("Error running bower", error.stack);
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     *
     * @param {String} bowerExecPath
     * @param {String} nodeCommandPath
     */
    runBower(bowerExecPath, nodeCommandPath) {
        let nodeCmd = nodeCommandPath || process.argv[0];
        if (nodeCmd.indexOf(" ") > 0) {
            nodeCmd = '"' + nodeCmd + '"';
        }
        return new Promise((resolve, reject) => {
            console.log("Checking if bower run is needed for " + this.projectDir);
            this.isBowerInstallNecessary().then(needed =>{
                if (needed) {
                    logger.info("Bower run necessary");
                    return this.invokeBower(bowerExecPath, nodeCmd, this.projectDir)
                        .then(() => {
                            console.info("Finished running bower");
                            resolve();
                        }, () => {
                            console.error("Failed to run bower");
                            reject();
                        });
                } else {
                    logger.info("Bower run not necessary");
                    resolve();
                }
            }, error =>{
                logger.error("Error checking if bower run is needed", error.stack);
                reject(error);
            });
        });
    }

}

module.exports = BowerUtils;