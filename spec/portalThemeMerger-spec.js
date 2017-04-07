const path = require("path");
const testUtils = require("../lib/testUtils");

const Project = require("../lib/protostarProject");
const TemplateComposer = require("../lib/templateComposer");
const StaticBuilder = require('../lib/StaticBuilder');
const PortalThemeMerger = require("../lib/portalThemeMerger");
let originalTimeout;

//if(false)
describe("portalThemeMerger", function(){
    beforeEach(function() {
        originalTimeout = jasmine.DEFAULT_TIMEOUT_INTERVAL;
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;
    });

    xit("can run", function(done){
        const dsvPrototypePath = '/home/spectre/Projects/IBM/DSV/mydsv-protostar/mydsv';
        const dsvThemePath = '/home/spectre/Projects/IBM/DSV/angularTheme';

        //var sampleProjectPath = path.join(__dirname, "../projects/sample")
        const runtime = testUtils.createTestRuntime(dsvPrototypePath);
        const targetDir = "/tmp/psMergeThemeTest_" + (new Date().getTime());
        runtime.targetDirPath = targetDir;
        runtime.targetDir = targetDir;
        const composer = new TemplateComposer({
            runtime: runtime
        });
        const project = new Project({
            runtime: runtime,
            composer: composer
        });



        const builder = new StaticBuilder({
            runtime: runtime,
            project: project,
            composer: composer,
            targetDir: targetDir,
            ignoreExcludeFromBuild: false
        });
        let portalThemeMerger = new PortalThemeMerger({
            targetDir : targetDir,
            projectPath : dsvPrototypePath,
            themePath : dsvThemePath,
            runtime:runtime,
            composer:composer,
            project:project,
            builder:builder
        });
        portalThemeMerger.mergeProject().then(function(){
            console.log("success");
            done();
        }).catch(function(){
            console.log("error ::: ",errors);
            done();
        });
    });
});