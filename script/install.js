'use strict';
var AdmZip = require('adm-zip');
var fs = require('fs-extra');
var path = require('path');
var request = require('request');
var requestProgress = require('request-progress');
var url = require('url');
var progress = require('progress');
var copier = require("../lib/copier");
var BowerUtils = require("../lib/bowerUtils");
var validExit = false;
var args = process.argv;
var nodeCommandPath = args[0];
var psdir = path.join(__dirname, "..");
var promisify = require('../lib/promisify');
function getPsPath(relPath) {
    return path.join(psdir, relPath);
}
function createLaunchers() {
    /*
     ___NODE_EXEC_PATH___
     ___PROTOSTARDIR___
     */
    var shell = fs.readFileSync(getPsPath("core/install/protostar.sh"), 'utf8').replace(/___NODE_EXEC_PATH___/g, nodeCommandPath).replace(/___PROTOSTARDIR___/g, psdir);
    var openDesktop = fs.readFileSync(getPsPath("core/install/Protostar.desktop"), 'utf8').replace(/___NODE_EXEC_PATH___/g, nodeCommandPath).replace(/___PROTOSTARDIR___/g, psdir);
    var osX = fs.readFileSync(getPsPath("core/install/Protostar.app/Contents/document.wflow"), 'utf8').replace(/___NODE_EXEC_PATH___/g, nodeCommandPath).replace(/___PROTOSTARDIR___/g, psdir);
    var windows = fs.readFileSync(getPsPath("core/install/protostar.bat"), 'utf8').replace(/___NODE_EXEC_PATH___/g, nodeCommandPath).replace(/___PROTOSTARDIR___/g, psdir);
    fs.writeFileSync(getPsPath('bin/protostar'), shell, 'utf8');
    fs.writeFileSync(getPsPath('bin/Protostar.desktop'), openDesktop, 'utf8');
    copier.copy(getPsPath('core/install/Protostar.app'), 'bin/Protostar.app');
    fs.writeFileSync(getPsPath('bin/Protostar.app/Contents/document.wflow'), osX, 'utf8');
    fs.writeFileSync(getPsPath('bin/protostar.bat'), windows, 'utf8');
    fs.chmodSync(getPsPath('bin/protostar'), '0755');
    fs.chmodSync(getPsPath('bin/Protostar.desktop'), '0755');
}

var bu = new BowerUtils(psdir);

let bowerDirPath = getPsPath("node_modules/bower/bin/bower");
bu.runBower(bowerDirPath, nodeCommandPath).then(function () {
    console.log("Creating launchers in " + psdir + "/bin ...");
    createLaunchers();
    console.log("Downloading ckeditor plugins ..");
    return initiateDownload("https://github.com/spantaleev/ckeditor-imagebrowser/archive/master.zip");
}).then(function (downloadedFile) {
    return extractArchive(downloadedFile);
}).then(function (extractedPath) {
    let targetPath = "bower_components/ckeditor/plugins/imagebrowser";
    return moveFiles(extractedPath, targetPath);
}).then(function () {
    return initiateDownload("http://download.ckeditor.com/sourcedialog/releases/sourcedialog_4.4.5.zip");
}).then(function (downloadedFile) {
    return extractArchive(downloadedFile);
}).then(function (extractedPath) {
    let targetPath = "bower_components/ckeditor/plugins/sourcedialog";
    return moveFiles(extractedPath, targetPath);
}).then(function () {
    console.log("BOth imagebrowser and sourcedialog ckeditor extensions are installed.");
    validExit = true;
    exit(0);
}).catch((err) => {
    console.error("Error during install.js : ", err);
    exit(1);
});

function exit(code) {
    validExit = true;
    process.exit(code || 0);
}
function initiateDownload(fileUrl) {

    return new Promise((resolve,reject) => {

        console.log("REQ: " + fileUrl);
        var requestOptions = {
            uri: fileUrl, encoding: null, followRedirect: true, headers: {}
        };
        var filePath = fileUrl.substring(fileUrl.lastIndexOf('/') + 1);
        var writePath = filePath + '-download-' + Date.now();
        console.log('Receiving ' + fileUrl + ' ...');
        var bar = null;
        let req = request(requestOptions, function (error, response, body) {
            console.log('');
            if (!error && response.statusCode === 200) {
                fs.writeFileSync(writePath, body);
                console.log('Received ' + Math.floor(body.length / 1024) + 'K');
                fs.renameSync(writePath, filePath);
                resolve(filePath);
            } else if (response) {
                // console.error('Error requesting archive : ' + response.statusCode);
                reject('Error requesting archive : ' + response.statusCode);
                // exit(1);
            } else if (error) {
                // console.error('Error making request.\n' + error.stack);
                reject('Error making request.\n' + error.stack);
                // exit(1);
            } else {
                // console.error('Unexpected error');
                reject('Unexpected error');
                // exit(1);
            }
        });
        let reqProgress = requestProgress(req);
        reqProgress.on('progress', function (state) {
            try {
                if (!bar) {
                    bar = new progress('  [:bar] :percent :etas', {total: state.total, width: 40});
                }
                bar.curr = state.received;
                bar.tick(0);
            } catch (e) {
            }
        });
    });

    // return deferred.promise;
}
function extractArchive(filePath) {
    return new Promise((resolve,reject) => {
        var extractedPath = filePath + '-extract-' + Date.now();
        var options = {cwd: extractedPath};
        fs.mkdirsSync(extractedPath, '0777');
        fs.chmodSync(extractedPath, '0777');
        console.log('Extracting ' + filePath + ' to ' + extractedPath + ' ...');
        try {
            var zip = new AdmZip(filePath);
            zip.extractAllTo(extractedPath, true);
            resolve(extractedPath);
        } catch (err) {
            console.error('Error extracting zip to ' + filePath);
            reject(err);
        }
    });
}
function moveFiles(extractedPath, targetPath) {
    console.log("Moving " + extractedPath + " => " + targetPath);
    return promisify(fs.remove)(targetPath)
        .then(() => {
            var files = fs.readdirSync(extractedPath);
            for (var i = 0; i < files.length; i++) {
                var file = path.join(extractedPath, files[i]);
                if (fs.statSync(file).isDirectory()) {
                    console.log('Copy extracted dir', file, ' to ', targetPath);
                    return promisify(fs.move)(file, targetPath);
                }
            }
            console.log('Could not find extracted file', files);
            throw new Error('Could not find extracted file');
        }).then(() => promisify(fs.remove)(extractedPath));
}
