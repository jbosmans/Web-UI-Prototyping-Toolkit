"use strict";
const utils = require("../utils");
const url = require("url");
const mime = require("mime");
const fs = require("../filesystem");
const logger = utils.createLogger({sourceFilePath: __filename});

/**
 *
 * @param {RequestContext} rc
 */
const serveExistingCssFile = function (rc) {
    const parsedUrl = url.parse(rc.request.url, true);
    const requestedFilePath = rc.runtime.findFileForUrlPathname(decodeURIComponent(parsedUrl.pathname));
    const handleExisting = function (stat) {
        fs.readFile(requestedFilePath).then(function (file) {
            const fileMime = mime.lookup(requestedFilePath);
            if (fileMime && (fileMime.indexOf("text/") === 0 || fileMime.indexOf('application/json') === 0 || fileMime.indexOf('application/javascript') === 0)) {
                utils.writeResponse(rc.response, 200, {
                    "Content-Type": fileMime,
                    "Content-Length": stat.size,
                    "Last-Modified": stat.ctime.toString()
                }, file);
            } else {
                utils.writeBinaryResponse(rc.response, 200, {
                    "Content-Type": fileMime,
                    "Content-Length": stat.size,
                    "Last-Modified": stat.ctime.toString()
                }, file);
            }
        }, function (err) {
            logger.error("Existing css file to serve does not exist: " + requestedFilePath, err.stack);
            utils.writeResponse(rc.response, 404, {
                "Content-Type": "text/plain; charset=utf-8"
            }, "File could not be found");
        });
    };
    const handleError = function (err) {
        logger.error("Existing css file to serve does not exist: " + requestedFilePath, err.stack);
        utils.writeResponse(rc.response, 404, {
            "Content-Type": "text/plain; charset=utf-8"
        }, "File could not be found");
    };
    fs.stat(requestedFilePath).then(handleExisting, handleError);
};
module.exports = serveExistingCssFile;