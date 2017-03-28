const marked = require('marked');

const createTableOfContents = function (source) {
    const FOUR_SPACES = "    ";
    const leftIndents = [""];
    for (let i = 1; i < 10; i++) {
        leftIndents.push(leftIndents[i - 1] + FOUR_SPACES);
    }
    function processData(data) {
        const lines = data.split('\n');
        const titles = [];
        const depths = [];
        let minDepth = 1000000;
        for (let i = 0; i < lines.length; i++) {
            let m = lines[i].match(/^\s*(#+)(.*)$/);
            if (!m) continue;
            minDepth = Math.min(minDepth, m[1].length);
            depths.push(m[1].length);
            titles.push(m[2]);
        }
        for (let j = 0; j < depths.length; j++) {
            depths[j] -= minDepth;
        }
        const toc = createTOC(depths, titles).join('\n');
        const tocRegexp = /^\s*<!-- TOC -->\s*$/;
        for (let k = 0; k < lines.length; k++) {
            if (tocRegexp.test(lines[k])) {
                lines[k] = '## Contents\n' + toc;
            }
        }
        return lines.join('\n');
    }

    function createTOC(depths, titles) {
        const ans = [];
        for (let i = 0; i < depths.length; i++) {
            ans.push(tocLine(depths[i], titles[i]));
        }
        return ans;
    }

    function titleToUrl(title) {
        return title.trim().toLowerCase().replace(/\s/g, '-').replace(/[^-0-9a-z]/g, '');
    }

    function tocLine(depth, title) {
        return leftIndents[depth] + "- [" + title.trim() + "](#" + titleToUrl(title) + ")";
    }

    return processData(source);
};

/**
 *
 * @param {String} source
 * @return {String}
 */
function compileMarkdown(source){
    return marked(source);
}

module.exports = {
    createTableOfContents:createTableOfContents,
    compileMarkdown:compileMarkdown
};