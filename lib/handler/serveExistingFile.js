"use strict";
const utils = require("../utils");
const url = require("url");
const fs = require("../filesystem");
const rfs = require("fs");
const mime = require("mime");
let stream = require("stream");
let zlib = require("zlib");
const logger = utils.createLogger({sourceFilePath: __filename});

let compression = true;

/**
 *
 * @param {RequestContext} rc
 */
const serveExistingFile = function (rc) {
    const parsedUrl = url.parse(rc.request.url, true);
    const requestedFilePath = rc.runtime.findFileForUrlPathname(decodeURIComponent(parsedUrl.pathname));

    const handleFileNotFound = function handleFileNotFound(err) {
        logger.error("Existing file to serve does not exist: " + requestedFilePath, err.stack);
        utils.writeResponse(rc.response, 404, {
            "Content-Type": "text/plain; charset=utf-8"
        }, "File could not be found");
    };

    const handleExistsCompressing = function handleExists(stat) {
        const begin = new Date().getTime();
        const fileMime = mime.lookup(requestedFilePath);
        const fileSize = stat.size;
        const textual = fileMime && (fileMime.indexOf("text/") === 0 || fileMime.indexOf('application/json') === 0 || fileMime.indexOf('application/javascript') === 0);
        if (textual) {
            const cached = {
                data: rc.runtime.readFile(requestedFilePath),
                size: fileSize,
                mime: fileMime,
                binary: false//,
            };

            const acceptEncoding = rc.request.headers['accept-encoding'];

            if(acceptEncoding){
                if (acceptEncoding.indexOf("deflate") >=0) {
                    let raw = new stream.Readable();
                    raw._read = function noop() {};
                    raw.push(cached.data);
                    raw.push(null);
                    rc.response.writeHead(200, {
                        'content-type': fileMime,
                        'content-encoding': 'deflate',
                        "Last-Modified": stat.ctime.toString()
                    });
                    raw.pipe(zlib.createDeflate()).pipe(rc.response);
                } else if (acceptEncoding.indexOf("gzip") >=0) {
                    let raw = new stream.Readable();
                    raw._read = function noop() {};
                    raw.push(cached.data);
                    raw.push(null);
                    rc.response.writeHead(200, {
                        'content-type':fileMime,
                        'content-encoding': 'gzip',
                        "Last-Modified": stat.ctime.toString()
                    });
                    raw.pipe(zlib.createGzip()).pipe(rc.response);
                } else {
                    utils.writeResponse(rc.response, 200, {
                        "Content-Type": fileMime,
                        "Content-Length": fileSize,
                        "Last-Modified": stat.ctime.toString()
                    }, cached.data);
                }
                let end = new Date().getTime();

                console.log("Served in " + (end-begin) + "ms: " + requestedFilePath);
            }else{
                utils.writeResponse(rc.response, 200, {
                    "Content-Type": fileMime,
                    "Content-Length": fileSize,
                    "Last-Modified": stat.ctime.toString()
                }, cached.data);
            }
            logger.debug("200 OK: GET " + parsedUrl.pathname + " " + cached.mime);

        } else {
            rc.response.writeHead(200, {
                "Content-Type": fileMime,
                "Content-Length": fileSize,
                "Last-Modified": stat.ctime.toString()
            });
            const rstream = rfs.createReadStream(requestedFilePath);

            rstream.on('end', () => {
                let end = new Date().getTime();
                logger.debug("Served in " + (end-begin) + "ms: " + requestedFilePath);
            });
            rstream.pipe(rc.response);
        }
    };


    const handleExists = function handleExists(stat) {
        const begin = new Date().getTime();
        const fileMime = mime.lookup(requestedFilePath);
        const textual = fileMime && (fileMime.indexOf("text/") === 0 || fileMime.indexOf('application/json') === 0 || fileMime.indexOf('application/javascript') === 0);
        if (textual) {
            const cached = {
                data: rc.runtime.readFile(requestedFilePath),
                size: stat.size,
                mime: fileMime,
                binary: false
            };
            utils.writeResponse(rc.response, 200, {
                "Content-Type": cached.mime,
                "Content-Length": fileSize,
                "Last-Modified": stat.ctime.toString()
            }, cached.data);
            let end = new Date().getTime();
        } else {
            rc.response.writeHead(200, {
                "Content-Type": fileMime,
                "Content-Length": fileSize,
                "Last-Modified": stat.ctime.toString()
            });
            const rstream = rfs.createReadStream(requestedFilePath);

            rstream.on('end', () => {
                let end = new Date().getTime();
                logger.debug("Served in " + (end-begin) + "ms: " + requestedFilePath);
            });
            rstream.pipe(rc.response);
        }
    };
    fs.stat(requestedFilePath).done((compression ? handleExistsCompressing : handleExists), handleFileNotFound);
};
module.exports = serveExistingFile;