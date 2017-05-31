"use strict";

var fs = require("fs");
var path = require("path");
var PortalThemeMerger = require("../../portalThemeMerger");
var portalTooling = require("../../portalTooling");

var renderValidationError = function(syncDirPath, valOut, rc){
    console.error("Validation of sync config failed for " + syncDirPath, valOut);
    var msg = "Failed config validation for pushing to WebDAV Theme sync dir " + syncDirPath ;
    valOut.messages.forEach(function (m) {
        msg += '<br>Error: ' + m;
    });
    msg += '<br>';
    valOut.missingFields.forEach(function (m) {
        msg += '<br>Error: missing proprety on '+ syncDirPath + path.sep + '.settings : ' + m;
    });
    renderError(msg, "Validation of sync config failed", rc);
};

var renderError = function(msg, errorTitle, rc){
    rc.composer.renderNewBackendView('<strong>'+msg+'</strong>', {
        title: 'Error - Push To WebDAV Theme - Protostar',
        pageTitle: errorTitle
    }, rc.response);
};

var renderSyncResult = function(syncDir, start, err, stdOut, stdErr, rc){
    console.log("stdout: " + stdOut);
    console.log("stderr: " + stdErr);
    var opener;
    var successful;
    if(err){
        console.error("Failed! ", err);
        opener = "Failed :-(";
        successful = false;
    }else{
        console.info("Success: " + stdOut);
        opener = "Success !";
        successful =true;
    }
    var out = '<div class="row"><div class="col-md-12">' +
        '<a href="/pscmds" class="btn btn-primary"><span class="glyphicon glyphicon-chevron-left"></span> Home</a>'+
        '<p>DXSync for <br><strong>'+syncDir+'</strong><br> to portal was started on '+start+'</p>' +
        '<p><a class="btn btn-primary" href="/?command=dxsync-push"><span class="glyphicon glyphicon-repeat"></span> Sync DX again</a></p>' +
        (stdOut ? '<h3>Console Output</h3><pre><code>'+stdOut+'</code></pre>' : '') +
        (stdErr ? '<h3>Console Error Output</h3><pre><code>'+stdErr+'</code></pre>' : '') +
        '</div></div>';
    var ptm = successful ? '<span class="text-success">'+opener+'</span>' : '<span class="text-danger">'+opener+'</span>';
    rc.project.deleteIntermediaryFiles();
    rc.composer.renderNewBackendView(out, {
        title: opener + ' - Push To WebDAV Theme - Protostar',
        pageTitle: ptm
    }, rc.response);
};

/**
 *
 * @param {RequestContext} rc
 */
module.exports=function (rc) {
    let dxSyncPathConfigured = portalTooling.isDxSyncPathConfigured(rc.project);
    let themeSyncDirConfigured = portalTooling.isThemeSyncDirConfigured(rc.project);
    if(dxSyncPathConfigured && themeSyncDirConfigured){
        var syncDirPath = portalTooling.getThemeSyncDirPath(rc.project);
        var valOut = portalTooling.validateThemeSyncDirSettings(syncDirPath);
        if (valOut.ok) {
            console.info("DXSync integration is enabled.");
            var start = new Date();
            let portalThemeMerger = new PortalThemeMerger({
                targetDir: syncDirPath,
                projectPath: rc.runtime.constructProjectPath('.'),
                runtime: rc.runtime,
                composer: rc.composer,
                project: rc.project
            });
            portalThemeMerger.mergeStatic().then(function () {
                portalTooling.pushThemeDirToWebDav(syncDirPath, portalTooling.getDxSyncExecutablePath(rc.project), function (err, syncDir, stdOut, stdErr) {
                    renderSyncResult(syncDir, start, err, stdOut, stdErr, rc);
                });
            }, function (err) {
                var msg = "Could not merge " + rc.runtime.projectDirPath + " to " + syncDirPath;
                console.error("Error during merge to " + syncDirPath + " : " + err.message, err.stack);
                rc.project.deleteIntermediaryFiles();
                renderError('<strong>' + msg + '</strong>', 'Error during merge to sync dir', rc);
            });
        } else {
            renderValidationError(syncDirPath, valOut, rc);
        }
    }else{
        console.error("DXSync integration is not configured correctly.");
        if(!dxSyncPathConfigured){
            console.error("Please make sure the dxsync executable path is configured in <protostar>/core/config/config.json");
            renderError('<strong>Incorrect DXSync path</strong>', 'Please make sure the dxsync executable path is configured in protostarDir/core/config/config.json', rc);
        }
        if(!themeSyncDirConfigured){
            console.error("Please make sure the themeSyncDir is configured in <project>/prototype.json");
            renderError('<strong>Incorrect theme sync dir</strong>', 'Please make sure the themeSyncDir is configured in projectDir/prototype.json', rc);
        }
    }
};
module.exports.label = 'Push Theme To Portal WebDAV';
module.exports.description = 'Merges built output into the configured DXSync directory and initiates a DXSync push command for that directory';