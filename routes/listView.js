var List = require('../models').List;

function get(req, res, next) {
  List.find({ userid: req.apiAuth.userId }, function(err, lists){
    res.json(lists);
  });
}

exports.get = get;
