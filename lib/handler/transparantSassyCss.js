"use strict";
const url = require("url");
const path = require("path");
const utils = require("../utils");
let sassCompiler;

const logger = utils.createLogger({sourceFilePath: __filename});

/**
 *
 * @param {RequestContext} rc
 */
const transparantSassyCss = function (rc) {
    if (!sassCompiler) {
        sassCompiler = require("../sassCompiler");
    }
    const parsedUrl = url.parse(rc.request.url, true);
    const urlPathname = decodeURIComponent(parsedUrl.pathname);
    const requestedFilePath = rc.runtime.findFileForUrlPathname(urlPathname);
    const sassInfo = utils.findCssPreProcessorInfo(requestedFilePath, ".scss");
    if (sassInfo) {
        const sassCode = rc.runtime.readFile(sassInfo.sourceFilePath);
        sassCompiler.renderSass(sassCode, [path.dirname(sassInfo.sourceFilePath)], path.basename(requestedFilePath), function (css, cssmap, stats) {
            if (sassInfo.outputFormat === 'map') {
                logger.debug("writing cssmap");
                rc.response.writeHead(200, {"Content-Type": "application/json; charset=utf-8"});
                let map = cssmap.toJSON();
                rc.response.write(cssmap.toString());
            } else {
                logger.debug("writing css");
                rc.response.writeHead(200, {"Content-Type": "text/css; charset=utf-8"});
                rc.response.write(css.toString());
            }
            rc.response.end();
        });
    } else {
        throw new Error("Cannot handle " + urlPathname + " => " + requestedFilePath);
        //handlers.handleCantResolveNonExistingFileRequest(rc.request, rc.response);
    }
};
module.exports = transparantSassyCss;