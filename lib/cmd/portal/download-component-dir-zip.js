"use strict";
var fs = require("fs");
var path = require("path");
var url = require("url");
var copier = require("../../copier");
var StaticBuilder = require('../../StaticBuilder');
var osTmpdir = require("os-tmpdir");
var zipUtils = require("../../zipUtils");
/**
 *
 * @param {RequestContext} rc
 */
module.exports= function (rc) {
    var dirParameterValue = rc.wr.getQueryParam('dir') || false;
    if(!dirParameterValue) {
        throw new Error("missing directory");
    }
    var projectDir = rc.runtime.projectDirPath;
    var cmpDirPath = path.resolve(projectDir, dirParameterValue);
    if(!rc.runtime.isExistingDirPath(cmpDirPath)){
        throw new Error("Not an existing dir path for " + dirParameterValue + ": " + cmpDirPath);
    }
    var builder = new StaticBuilder({
        runtime : rc.runtime,
        project : rc.project,
        composer :rc.composer
    });

    var ts = new Date().getTime();
    var dirName = path.basename(cmpDirPath);
    var targetDir = osTmpdir() + path.sep +  path.basename(rc.runtime.constructProjectPath(".")) + "_component_" + dirName + "_" +ts;

    builder.buildComponentDir(cmpDirPath, targetDir, function(){
        console.log("Finished building component dir "+cmpDirPath+" to " + targetDir);
        var zipFileName = dirName + ".zip";
        var filePath = osTmpdir() + path.sep + 'cmpZip_' + (new Date().getTime()) + '.zip';
        zipUtils.zipDirectory(targetDir, filePath);
        var buffer = fs.readFileSync(filePath);
        rc.response.writeHead(200, {
            'Expires': 0,
            'Cache-Control': 'must-revalidate, post-check=0, pre-check=0',
            'Content-Description': 'File Transfer',
            'Content-type': 'application/octet-stream',
            'Content-Disposition': 'attachment; filename=\"' + zipFileName+'\"',
            'Content-Transfer-Encoding': 'binary',
            "Content-Length": buffer.length
        });
        rc.response.write(buffer, "binary");
        rc.response.end();

        rc.project.deleteIntermediaryFiles();
        fs.unlinkSync(filePath);
    });
};
module.exports.label = 'Download Component Dir ZIP';
module.exports.description = '';
module.exports.noMenu = true;