var roles = require('../lib/roles.js');

function getAppData(req, res, next) {
  roles.get(function (err, data) {
    res.send({roles: data});
    next();
  });
}

exports.get = getAppData;
