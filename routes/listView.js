var   _ = require('lodash'),
  List = require('../models').List;

function get(req, res, next) {
  List.find({ users: req.apiAuth.userId }, function(err, lists){
    if (err) {
      return res.json({status: "error", message: "There was an error retrieving the custom contact lists."});
    }

    res.json({ status: "ok", lists: lists });
  });
}

exports.get = get;
