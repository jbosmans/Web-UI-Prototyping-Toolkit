const path= require("path");
const utils = require('./utils');
const zlib = require('zlib');
const stream = require("stream");
const lessCssSupport = require('./lessCssSupport');
const logger = utils.createLogger({sourceFilePath : __filename});

class CssWriter {
    constructor(idx, filename, response, mode) {
        this.mode = 'css';
        if (typeof mode === 'string') {
            this.mode = mode;
        }
        this.idx = idx;
        this.filename = filename;
        this.response = response;
        this.done = false;
        this.css = undefined;
        this.cssMap = undefined;
        this.dependencies = undefined;
    }

    acceptCss(css, cssmap, deps) {
        this.css = css;
        this.cssMap = cssmap;
        this.dependencies = deps;
        this.done = true;
    }

    writeCss() {
        const t = this;
        if (this.mode === 'css') {
            if (/-splitIE[0-9]*\.css$/.test(this.filename)) {
                throw new Error("splitIE support is disabled");
            } else {
                this.writeCompressedResponse("" + this.css, "text/css; charset=utf-8", "gzip", t.response);
            }
        } else if (this.mode === 'cssmap') {
            this.writeCssMap();
        } else if (this.mode === 'deps') {
            this.writeDependencies();
        }
    }

    writeCssMap() {
        this.response.writeHead(200, {"Content-Type": "application/json; charset=utf-8"});
        this.response.write("" + this.cssMap);
        this.response.end();
    }

    writeDependencies() {
        this.response.writeHead(200, {"Content-Type": "application/json; charset=utf-8"});
        this.response.write(JSON.stringify(this.dependencies));
        this.response.end();
    }
    writeCompressedResponse(content, mime, acceptEncoding, response) {
        //var acceptEncoding = request.headers['accept-encoding'];
        //console.log("ACCEPT == " + acceptEncoding);
        if (acceptEncoding) {
            const raw = new stream.Readable();
            raw._read = function noop() {
            }; // redundant? see update below
            raw.push(content);
            raw.push(null);

            if (acceptEncoding.indexOf("deflate") >= 0) {
                response.writeHead(200, {'content-type': mime, 'content-encoding': 'deflate'});
                raw.pipe(zlib.createDeflate()).pipe(response);
                //response.end();
            } else if (acceptEncoding.indexOf("gzip") >= 0) {
                response.writeHead(200, {'content-type': mime, 'content-encoding': 'gzip'});
                raw.pipe(zlib.createGzip()).pipe(response);
                //response.end();
            } else {
                utils.writeResponse(response, 200, {
                    "Content-Type": mime,
                    //"Content-Length": cached.size
                }, content);
            }

        } else {
            utils.writeResponse(response, 200, {
                "Content-Type": mime,
                //"Content-Length": cached.size
            }, content);
        }
    }
}

class ServerSideLessCompiler{
    constructor(basePath,lessParserAdditionalArgsFn){
        this.basePath = basePath;
        this.lessParserAdditionalArgsFn = lessParserAdditionalArgsFn;
        this.compiledLessCache = {};
        this.lessFilePathsBeingCompiled= {};
        this.onlyUsedLessFilePathsBeingCompiled= {};
        this.nextCallIdx= 1;
        this.onlyUsedNextCallIdx= 1;
        // this.enableCaching = false;
    }

    createKey(lessFilePath, lessParentDirs, basePath, additionalParserArgs) {
        let key = lessFilePath + "_" + lessParentDirs.join("_") + "_" + basePath;
        if (additionalParserArgs) {
            for (let levelOneKey in additionalParserArgs) {
                let levelOneVal = additionalParserArgs[levelOneKey];
                if (typeof levelOneVal !== 'object') {
                    key += "_" + levelOneKey + "_" + levelOneVal;
                } else {
                    for (let levelTwoKey in levelOneVal) {
                        key += "_" + levelOneKey + "." + levelTwoKey + "=" + levelOneVal[levelTwoKey];
                    }
                }
            }
        }
        return key;
    }

    handleCompileLessCss(inFilename, response) {
        let filename= inFilename;
        const callIdx = this.nextCallIdx;
        this.nextCallIdx += 1;
        const self = this;
        const finishedCompilingCss = function (css, sourceMap, deps) {
            if(self.lessFilePathsBeingCompiled && self.lessFilePathsBeingCompiled[filename]){

            }
            const callbacks = self.lessFilePathsBeingCompiled[filename];
            delete self.lessFilePathsBeingCompiled[filename];
            const cbc = callbacks.length;
            while (callbacks.length > 0) {
                const cb = callbacks[0];
                callbacks.splice(0, 1);
                cb.acceptCss(css, sourceMap, deps);
                cb.writeCss();
            }
            logger.debug("Served " + cbc + " requests for " + filename);
        };
        if (this.lessFilePathsBeingCompiled.hasOwnProperty(filename)) {
            const callbacks = this.lessFilePathsBeingCompiled[filename];
            callbacks.push(new CssWriter(callIdx, inFilename, response, 'css'));
        } else {
            const cacheKey = this.createKey(inFilename, [path.dirname(inFilename)], this.basePath, typeof this.lessParserAdditionalArgsFn === 'function' ? this.lessParserAdditionalArgsFn() : undefined);
            let ready = false;
            if(this.compiledLessCache.hasOwnProperty(cacheKey)){
                const cached = this.compiledLessCache[cacheKey];
                const newLatest = utils.findLatestMod(inFilename, cached.deps);
                if(newLatest <= cached.latestMod){
                    logger.debug("Using smart cached less output for " + inFilename + "   cacheKey="+cacheKey);
                    let w = new CssWriter(0, inFilename, response, 'css');
                    w.acceptCss(cached.css, cached.cssmap, cached.deps);
                    w.writeCss();
                    ready = true;
                }
            }
            if(ready){
                return;
            }
            this.lessFilePathsBeingCompiled[filename] = [];
            this.lessFilePathsBeingCompiled[filename].push(new CssWriter(callIdx, inFilename, response, 'css'));
            let currentAdditionalVars = typeof this.lessParserAdditionalArgsFn === 'function' ? (this.lessParserAdditionalArgsFn)() : undefined;
            let options;
            if(!!currentAdditionalVars){
                options = {};
                Object.keys(currentAdditionalVars).forEach((vn) => {
                    options[vn] = currentAdditionalVars[vn];
                });
            }
            lessCssSupport.compile(lessCssSupport.createRequest(filename, this.basePath, options)).then((result) => {
                this.compiledLessCache[cacheKey] = {
                    latestMod : utils.findLatestMod(filename, result.dependencies),
                    deps : result.dependencies,
                    css : result.css,
                    cssmap : result.cssMap
                };
                finishedCompilingCss(result.css, result.cssMap, result.dependencies);
            }, (errors) => {
                console.error("could not compile " + filename, errors);
                throw new Error("could not compile " + filename);
            });
        }
    }
    handleCompileLessCssMap(filename, response) {
        const callIdx = this.nextCallIdx;
        this.nextCallIdx += 1;
        const self = this;
        const finishedCompilingCssMap = function (css, sourceMap, deps) {
            const callbacks = self.lessFilePathsBeingCompiled[filename];
            delete self.lessFilePathsBeingCompiled[filename];
            const cbc = callbacks.length;
            while (callbacks.length > 0) {
                const cb = callbacks[0];
                callbacks.splice(0, 1);
                cb.acceptCss(css, sourceMap, deps);
                cb.writeCss();
            }
            logger.debug("Served " + cbc + " requests for " + filename);
        };
        if (this.lessFilePathsBeingCompiled.hasOwnProperty(filename)) {
            const callbacks = this.lessFilePathsBeingCompiled[filename];
            callbacks.push(new CssWriter(callIdx, filename, response, 'cssmap'));
        } else {
            let inFilename = filename;
            const cacheKey = this.createKey(inFilename, [path.dirname(inFilename)], this.basePath, typeof this.lessParserAdditionalArgsFn === 'function' ? this.lessParserAdditionalArgsFn() : undefined);
            let ready = false;
            if(this.compiledLessCache.hasOwnProperty(cacheKey)){
                const cached = this.compiledLessCache[cacheKey];
                const newLatest = utils.findLatestMod(inFilename, cached.deps);
                if(newLatest <= cached.latestMod){
                    logger.debug("Using smart cached less output for " + inFilename + "   cacheKey="+cacheKey);
                    let w = new CssWriter(0, inFilename, response, 'cssmap');
                    w.acceptCss(cached.css, cached.cssmap, cached.deps);
                    w.writeCss();
                    ready = true;
                }
            }
            if(ready){
                return;
            }
            this.lessFilePathsBeingCompiled[filename] = [];
            this.lessFilePathsBeingCompiled[filename].push(new CssWriter(callIdx, filename, response, 'cssmap'));

            lessCssSupport.compile(lessCssSupport.createRequest(filename, this.basePath)).then((r) => {
                this.compiledLessCache[cacheKey] = {
                    latestMod : utils.findLatestMod(filename, r.dependencies),
                    deps : r.dependencies,
                    css : r.css,
                    cssmap : r.cssMap
                };
                finishedCompilingCssMap(r.css, r.cssMap, r.dependencies);
            }, (err) => {
                console.error("Failed to compile css map for " + filename, err);
            });
        }
    }
}
module.exports = ServerSideLessCompiler;