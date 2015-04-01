var models = require('../models');
var log = require('../log');

function getAppData(req, res, next) {
  models.Cache.findOne({"name": "appData"}, function (err, doc) {
    if (err || !doc || !doc.data) {
      res.send(500, "An error occurred while preparing app data.");
      return cb(err);
    }

    res.send(doc.data);
    log.info({'type': 'getAppData:success', 'message': 'Successfully returned app data'});
  });
}

exports.get = getAppData;
