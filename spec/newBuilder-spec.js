const NewBuilder = require('../lib/NewBuilder');
const ProtostarRuntime = require('../lib/runtime');
const Project = require('../lib/protostarProject');
const TemplateComposer = require('../lib/templateComposer');
describe('NewBuilder', function(){
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;
    it('can build a project', function(done){
        let r = new ProtostarRuntime({
            protostarDirPath : '/home/spectre/Projects/WUIPT',
            projectDirPath : '/home/spectre/Projects/WUIPT/projects/sample',
            // projectDirPath : '/home/spectre/Projects/IBM/hasbro/playdoh_prototype',
            targetDirPath: '/tmp/testBuild'
        });
        let c = new TemplateComposer({
            runtime : r
        });
        let p = new Project({
            runtime: r,
            composer : c
        });

        let b = new NewBuilder({
            runtime : r,
            project : p,
            composer : c,
            targetDir : '/tmp/testBuild'
        });
        b.buildPrototype().then(() => {
            console.info("BUILD SUCCESS");
            done();
        }, () => {
            console.error("BUILD FAIL");
            done();
        }).catch((error) => {
            console.error("Hard fail: ", error);
            done();
        })
    });
    it('can build a project to ZIP', function(done){
        let r = new ProtostarRuntime({
            protostarDirPath : '/home/spectre/Projects/WUIPT',
            projectDirPath : '/home/spectre/Projects/WUIPT/projects/sample',
            // projectDirPath : '/home/spectre/Projects/IBM/hasbro/playdoh_prototype',
            targetDirPath: '/tmp/testBuild'
        });
        let c = new TemplateComposer({
            runtime : r
        });
        let p = new Project({
            runtime: r,
            composer : c
        });

        let b = new NewBuilder({
            runtime : r,
            project : p,
            composer : c,
            targetDir : '/tmp/testBuild'
        });
        b.createZipBuild().then(() => {
            console.info("ZIP BUILD SUCCESS");
            done();
        }, () => {
            console.error("ZIP BUILD FAIL");
            done();
        }).catch((error) => {
            console.error("ZIP Hard fail: ", error);
            done();
        })
    })
});
describe('portal merger', function(){
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;
    fit('can merge static theme files from a prototype', function(done){
        let portalThemeMerger = require('../lib/portalThemeMerger');
        let r = new ProtostarRuntime({
            protostarDirPath : '/home/spectre/Projects/WUIPT',
            projectDirPath : '/home/spectre/Projects/WUIPT/projects/sample',
            // projectDirPath : '/home/spectre/Projects/IBM/hasbro/playdoh_prototype',
            targetDirPath: '/tmp/testMergeStatic'
        });
        let c = new TemplateComposer({
            runtime : r
        });
        let p = new Project({
            runtime: r,
            composer : c
        });
        portalThemeMerger.mergeStatic({
            targetDir: '/tmp/testMergeStatic',
            projectPath: '/home/spectre/Projects/WUIPT/projects/sample',
            runtime: r,
            composer: c,
            project: p
        }).then(function () {
            console.info("Successfully merged static files to "  + '/tmp/testMergeStatic');
            done();
        }, function () {
            console.error("Errer during merge of static files to " + '/tmp/testMergeStatic', arguments);
            done();
        }).catch(function (errors) {
            console.error("Errer during merge of static files to " + '/tmp/testMergeStatic', arguments);
            done();
        });
    });
});