"use strict";
var utils = require("../utils");
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
            if (lessInfo.outputFormat === 'map') {
                rc.project.sslc.handleCompileLessCssMap(lessInfo.sourceFilePath, rc.response);
            } else {
                rc.project.sslc.handleCompileLessCss(lessInfo.sourceFilePath, rc.response);
            }
        } else {
            throw new Error("Cannot handle " + rc.wr.getPathname() + " => " + requestedFilePath);
        }
    });

};
module.exports = transparantLessCss;