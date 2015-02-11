var roles = require('../lib/roles.js');
var protectedRoles = require('../lib/protectedRoles.js');

function getAppData(req, res, next) {
  roles.get(function (err, data) {
    res.send({roles: data});
  });

  protectedRoles.get(function (err, data) {
    res.send({protectedRoles : data});
  });
}

exports.get = getAppData;
