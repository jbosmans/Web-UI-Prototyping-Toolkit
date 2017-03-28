const NewBuilder = require('../lib/NewBuilder');
const ProtostarRuntime = require('../lib/runtime');
const Project = require('../lib/protostarProject');
const TemplateComposer = require('../lib/templateComposer');
describe('NewBuilder', function(){
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;
    fit('can build a project', function(done){
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
})