module.exports =function (nodeAsyncFn, context) {
    return function () {
        return new Promise((resolve, reject) => {
            let args = Array.prototype.slice.call(arguments);
            args.push(function (err, val) {
                if (err !== null) {
                    return reject(err);
                }
                return resolve(val);
            });
            nodeAsyncFn.apply(context || {}, args);
        });
    };
};