"use strict";
var utils = require("../utils");
var url = require("url");
var fs = require("fs");
var cheerio = require("cheerio");
var jadeUtils = require("../jadeUtils");
var hbsUtils = require("../hbsUtils");
var path = require("path");
var logger = utils.createLogger({sourceFilePath : __filename});

/**
 *
 * @param {RequestContext} rc
 */
var transparantLessCss = function (rc) {
    var requestedFilePath = rc.runtime.findFileForUrlPathname(rc.wr.getPathname());
    var lessInfo = utils.findCssPreProcessorInfo(requestedFilePath, ".less");
    logger.info("Less Info = ", lessInfo);
    setImmediate(function(){
        if (lessInfo) {
            var sourceFilePathRef = lessInfo.sourceFilePath;
            //remove outdated browser support (as in ancient IE)
            // if(/-splitIE[0-9]*\.css$/.test(requestedFilePath)){
            //     sourceFilePathRef = path.resolve(path.dirname(sourceFilePathRef), path.basename(requestedFilePath));
            // }
            if (lessInfo.outputFormat === 'map') {
                rc.project.sslc.handleCompileLessCssMap(sourceFilePathRef, rc.response);
            } else {
                rc.project.sslc.handleCompileLessCss(sourceFilePathRef, rc.response);

            }
        } else {
            throw new Error("Cannot handle " + rc.wr.getPathname() + " => " + requestedFilePath);
        }
    });

};
module.exports = transparantLessCss;