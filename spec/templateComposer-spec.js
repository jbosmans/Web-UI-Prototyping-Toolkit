/**
 * Copyright 2014 IBM Corp.
 * 
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 * 
 *      http://www.apache.org/licenses/LICENSE-2.0
 * 
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 *
 */

var TemplateComposer = require("../lib/templateComposer");
var fs = require("fs");
var testUtils = require("../lib/testUtils");
var utils = require("../lib/utils");
var path = require("path");
var templatesParent =path.join(testUtils.getTestProjectDir(), "component") + "/";

/**
 *
 * @return {templateComposer.TemplateComposer}
 */
function newTemplateComposer(){
    var h = new TemplateComposer({
        runtime: testUtils.createTestRuntime()
    });
    return h;
}

describe("Template Compser", function () {

    it("should create a template composer", function () {
        console.log("test1");
        var h = newTemplateComposer();
        expect(typeof h).toBe("object");
        var templatePaths = fs.readdirSync(templatesParent);
        var num = 0;
        templatePaths.forEach(function(p, idx){
            var filePath = templatesParent + p;
            if(fs.statSync(filePath).isFile() && filePath.indexOf(".html") > 0){
                var fileContents = '' + fs.readFileSync(filePath);
                console.log("Composing " + p);
                var composed = h.composeTemplate(filePath, "" + fileContents);
                num +=1;
                console.log("Compiled from " + p + " " + fileContents.length + " bytes => " + composed.content.length + " bytes");
            }
        });
        console.log("Compiled " + num + " templates");
    });

    it("counts occurrences in text between indexes", function(){
        console.log("test6");
        var cnt = "aaaa";
        var count = utils.countOccurrencesBetweenIndexes(cnt, "a", 1, 3);
        expect(count).toBe(2);
    });
    it("find the nth occurrence", function(){
        console.log("test6");
        var cnt = "babababab";
        var indx = utils.findNthOccurrence(cnt, "a", 1, 0);
        expect(indx).toBe(1);
        var indx2 = utils.findNthOccurrence(cnt, "a", 2, 0);
        expect(indx2).toBe(3);
        var indx3 = utils.findNthOccurrence(cnt, "a", 2, 2);
        expect(indx3).toBe(5);

    });

    it("should support new layout args: surrounded by braces, assigning string as content, by name, multiple per droppoint, nested", function(){
    //    <!-- layout:layouts/fullPage(file:_dynamic/list-referencing-bare;layout:layouts/fullPage(component/myEditableComponent);file:component/myComponent) -->
    //    <!-- layout:layouts/fullPage(nav=file:_dynamic/list-referencing-bare;top=layout:layouts/fullPage(component/myEditableComponent);bottom=file:component/myComponent) -->
        var tp = newTemplateComposer();



    });

    it("should replace lorem calls", function(){
        var tp=newTemplateComposer();
        var indexPath = path.resolve(testUtils.getTestProjectDir(), "index.html");
        var composed = tp.composeTemplate(indexPath, "" + fs.readFileSync(indexPath), 1);
        //console.log("LOREM DROP POINTS: ", tp.findDropPoints(indexPath, "" + fs.readFileSync(indexPath), "lorem"));
        //console.log("COMPOSED : ", composed);
        expect(composed.content.indexOf('<!-- lorem:') >= 0).toBe(false);
    });
    it("should allow wrap calls with args for other drop points", function(){
        //var tp=newTemplateComposer();
        var testsProjDir = path.join(__dirname, "files/testsProj");
        var tp = new TemplateComposer({
            runtime: testUtils.createTestRuntime(testsProjDir)
        });
        var indexPath = path.resolve(testsProjDir, "index.html");
        var composed = tp.composeTemplate(indexPath, "" + fs.readFileSync(indexPath));
        var expected = '<h1>hey</h1><div>yow</div><p>S</p><p>S</p>';
        expect(composed.content).toBe(expected);
    });
    it("should allow wrap calls with args based on JSON data object", function(){

        //var tp=newTemplateComposer();
        var testsProjDir = path.join(__dirname, "files/testsProj");
        var tp = new TemplateComposer({
            runtime: testUtils.createTestRuntime(testsProjDir)
        });
        function testCompile(templateName, expected){
            var indexPath = path.resolve(testsProjDir, templateName);
            var composed = tp.composeTemplate(indexPath, "" + fs.readFileSync(indexPath));
            expect(composed.content).toBe(expected);
        }
        testCompile("index-jsonSingleObj.html", '<h1>t1</h1><div>yow</div><p>S</p>');
        testCompile("index-jsonMultiObj.html", '<h1>t1</h1><div>yow</div><p>S</p>');
        testCompile("index-jsonMultiObj2.html", '<h1>t2</h1><div>yow</div><p>S</p><p>S</p>');
        testCompile("index-jsonMultiArrayByIndex.html", '<h1>t2</h1><div>yow</div><p>S</p><p>S</p>');
        testCompile("index-jsonMultiArrayByKeyVal.html", '<h1>t1</h1><div>yow</div><p>S</p>');
    });
    it("should convert layout to hb", function(){
        var h = newTemplateComposer();
        var repl = h.convertLayoutToHandlebars('a<!-- content:x --> b <!-- content:y -->c');
        expect(repl).toBe('a{{{x}}} b {{{y}}}c');
    });
    it("should convert hb to layout", function(){
        var h = newTemplateComposer();
        var repl = h.convertHandlebarsToLayout('a{{x}} b {{y}}c');
        expect(repl).toBe('a<!-- content:x --> b <!-- content:y -->c');
    });
});