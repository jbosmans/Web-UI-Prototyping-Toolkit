const fs = require("fs");

const promisify = require('./promisify');

module.exports = {
    readFile: promisify(fs.readFile),
    readFileSync: fs.readFileSync,
    writeFile: promisify(fs.writeFile),
    writeFileSync: fs.writeFileSync,
    stat: promisify(fs.stat),
    statSync: fs.statSync,
    readdir: promisify(fs.readdir),
    readdirSync: fs.readdirSync,
    mkdir: promisify(fs.mkdir),
    mkdirSync: fs.mkdirSync,
    exists: promisify(fs.exists),
    existsSync: fs.existsSync,
    unlink: promisify(fs.unlink),
    unlinkSync: fs.unlinkSync
};