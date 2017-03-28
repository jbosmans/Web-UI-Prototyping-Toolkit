const less = require('less');
const path = require('path');
const fs = require('fs');
const utils = require('./utils');
const logger = utils.createLogger({sourceFilePath : __filename});

class LessCssCompilationRequest{
    constructor({sourceFile, basePath, options}){
        this._sourceFile = sourceFile;
        this._basePath = basePath;
        this._options = options;
    }

    get basePath() {
        return this._basePath;
    }
    set basePath(value) {
        this._basePath = value;
    }

    get sourceFile() {
        return this._sourceFile;
    }

    set sourceFile(value) {
        this._sourceFile = value;
    }

    get options() {
        return this._options;
    }

    set options(value) {
        this._options = value;
    }
}

class CompiledLessCss{
    /**
     *
     * @param {LessCssCompilationRequest} request
     * @param css
     * @param cssMap
     * @param dependencies
     */
    constructor({request, css, cssMap, dependencies}){
        this._request = request;
        this._css = css;
        this._cssMap = cssMap;
        this._dependencies = dependencies;
    }

    get request() {
        return this._request;
    }
    set request(value) {
        this._request = value;
    }

    get css() {
        return this._css;
    }

    set css(value) {
        this._css = value;
    }

    get cssMap() {
        return this._cssMap;
    }

    set cssMap(value) {
        this._cssMap = value;
    }

    get dependencies() {
        return this._dependencies;
    }

    set dependencies(value) {
        this._dependencies = value;
    }
}

class LessCssSupport {
    createRequest(filePath, basePath, options){
        if(typeof filePath !== 'string') throw new Error("filePath must be string");
        if(typeof basePath !== 'string') throw new Error("basePath must be string");
        if(options){
            return new LessCssCompilationRequest({
                sourceFile: filePath,
                basePath: basePath,
                options: options
            })
        }else{
            return new LessCssCompilationRequest({
                sourceFile: filePath,
                basePath: basePath
            })
        }
    }
    /**
     * Returns a Promise that resolves to (css, cssMap, dependencies)
     * @param {LessCssCompilationRequest} req
     // * @param {object} [options]
     * @return {Promise}
     */
    compile(req){
        const lessFilePath = req.sourceFile;
        console.log("Compiling " + lessFilePath);
        const options = req.options || {};
        options.filename = lessFilePath;
        if(!options.paths){
            options.paths =  [path.dirname(lessFilePath)];
        }
        if(!options.sourceMapBasepath){
            options.sourceMapBasepath = req.basePath;
        }
        if(!options.sourceMap){
            let pathWithoutExtension = lessFilePath.substring(0, lessFilePath.lastIndexOf('.'));
            let cssMapFilePath = pathWithoutExtension + '.css.map';
            let cssMapFilename = path.basename(cssMapFilePath);
            options.sourceMap = {
                outputSourceFiles: false,
                sourceMapFileInline: false,
                sourceMapBasepath : req.basePath,
                sourceMapRootpath: path.relative(path.dirname(lessFilePath), req.basePath),
                sourceMapFilename: cssMapFilename//,
            };
        }
        options.relativeUrls = true;
        return new Promise((resolve,reject)=>{
            logger.info("Compiling " + lessFilePath);
            logger.debug("Compiling " + lessFilePath + " with options :", options);
            /*
            var example = {
                filename: '/home/spectre/Projects/protostar-projects/highfive_rebranding/css/mystyles.less',
                depends: false,
                compress: false,
                max_line_len: -1,
                lint: false,
                paths: ['/home/spectre/Projects/protostar-projects/highfive_rebranding/css'],
                color: true,
                strictImports: false,
                insecure: false,
                rootpath: '',
                relativeUrls: true,
                ieCompat: true,
                strictMath: false,
                strictUnits: false,
                globalVars: null,
                modifyVars: null,
                urlArgs: '',
                plugins: [],
                sourceMap: {
                    outputSourceFiles: true,
                    sourceMapBasepath: '../css',
                    sourceMapRootpath: '../css',
                    sourceMapInputFilename: '/home/spectre/Projects/protostar-projects/highfive_rebranding/css/mystyles.less',
                    sourceMapOutputFilename: 'mystyles.css',
                    sourceMapFullFilename: '/home/spectre/Projects/protostar-projects/highfive_rebranding/css/mystyles.css.map',
                    sourceMapFilename: 'mystyles.css.map',
                    sourceMapFileInline: false
                }

            };
            */
            let fileContents = fs.readFileSync(lessFilePath, 'utf8');
            less.render(fileContents, options)
                .then(function (output) {
                        logger.info("Finished compiling " + lessFilePath);
                        const out = new CompiledLessCss({
                            request: req,
                            css: output.css,
                            cssMap: output.map,
                            dependencies: output.imports
                        });
                        resolve(out);
                    },
                    function (error) {
                        console.error("Failed to compile css! " + lessFilePath, arguments);
                        reject(error);
                    });
        });
    }
    compileFiles(requests){
        return Promise.all(requests.map((req) => this.compile(req)));
    }
}


const lessCssSupport = new LessCssSupport();
lessCssSupport.LessCssCompilationRequest = LessCssCompilationRequest;
lessCssSupport.CompiledLessCss = CompiledLessCss;

module.exports = lessCssSupport;
