"use strict";
const utils = require("../utils");
const url = require("url");
const fs = require("../filesystem");
const rfs = require("fs");
const mime = require("mime");
let stream = require("stream");
let zlib = require("zlib");
const logger = utils.createLogger({sourceFilePath: __filename});

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

    const handleExists = function handleExists(stat) {
        // var changeTime = stat.ctime.getTime();
        const begin = new Date().getTime();
        const fileMime = mime.lookup(requestedFilePath);
        // var after = new Date().getTime();
        // var mimeDiff = after-before;
        // console.log("Mime in " + mimeDiff + "ms : " + requestedFilePath);
        const textual = fileMime && (fileMime.indexOf("text/") === 0 || fileMime.indexOf('application/json') === 0 || fileMime.indexOf('application/javascript') === 0);
        if (textual) {
            const cached = {
                data: rc.runtime.readFile(requestedFilePath),
                size: stat.size,
                mime: fileMime,
                binary: false//,
                // lastModified : changeTime
            };
            utils.writeResponse(rc.response, 200, {
                "Content-Type": cached.mime,
                "Content-Length": cached.size,
                // "Date" : stat.ctime.toString(),
                "Last-Modified": stat.ctime.toString()
            }, cached.data);
            let end = new Date().getTime();

            // console.log("Served in " + (end-begin) + "ms: " + requestedFilePath);

            // var acceptEncoding = rc.request.headers['accept-encoding'];
            // //console.log("ACCEPT == " + acceptEncoding);
            // if(acceptEncoding){
            //     var raw;
            //
            //
            //     if (acceptEncoding.indexOf("deflate") >=0) {
            //         raw = new stream.Readable();
            //         raw._read = function noop() {}; // redundant? see update below
            //         raw.push(cached.data);
            //         raw.push(null);
            //         rc.response.writeHead(200, { 'content-type':cached.mime,'content-encoding': 'deflate' });
            //         raw.pipe(zlib.createDeflate()).pipe(rc.response);
            //     } else if (acceptEncoding.indexOf("gzip") >=0) {
            //         raw = new stream.Readable();
            //         raw._read = function noop() {}; // redundant? see update below
            //         raw.push(cached.data);
            //         raw.push(null);
            //         rc.response.writeHead(200, { 'content-type':cached.mime,'content-encoding': 'gzip' });
            //         raw.pipe(zlib.createGzip()).pipe(rc.response);
            //     } else {
            //         utils.writeResponse(rc.response, 200, {
            //             "Content-Type": cached.mime,
            //             "Content-Length": cached.size
            //         }, cached.data);
            //     }
            // }else{
            //     utils.writeResponse(rc.response, 200, {
            //         "Content-Type": cached.mime,
            //         "Content-Length": cached.size
            //     }, cached.data);
            // }
            // logger.debug("200 OK: GET " + parsedUrl.pathname + " " + cached.mime);

        } else {
            rc.response.writeHead(200, {
                "Content-Type": fileMime,
                "Content-Length": stat.size,
                // "Date" : stat.ctime.toString(),
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
    fs.stat(requestedFilePath).done(handleExists, handleFileNotFound);
};
module.exports = serveExistingFile;