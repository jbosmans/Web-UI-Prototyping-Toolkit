const lessSupport = require('../lib/lessCssSupport');

describe('less support', function(){
    it('compiles a less file to css, returning a promise', function(done){
        let req = new lessSupport.LessCssCompilationRequest({
            sourceFile:'/home/spectre/Projects/protostar-projects/highfive_rebranding/css/styles.less',
            options: {

                sourceMap : {
                    sourceMapFileInline: false,
                    outputSourceFiles: true
                }
            }
        });
        lessSupport.compile(req)
            .then(function(result){
                expect(result).not.toBeNull();
                console.log('css type: ' + typeof result.css);
                console.log('cssMap type: ' + typeof result.cssMap);
                console.log('dependencies type: ' + typeof result.dependencies);
                // console.log("The MAP = ", result.cssMap);
                done()
            }, function(err){
                console.log("fail: ", err);
                done()
            });

    });
    it('compiles multiple css files', function(done){
        const sourceFiles = [
            '/home/spectre/Projects/WUIPT/projects/sample/less/styles.less',
            '/home/spectre/Projects/protostar-projects/highfive_rebranding/css/styles.less'
        ];
        lessSupport.compileFiles(sourceFiles.map((f) => lessSupport.createRequest(f))).then((results) => {

            console.log("success multiple");
            debugger;
            console.log("results = ", results);
            done();
        }, () => {
            console.error("fail multiple");
            done();
        });
    })
})