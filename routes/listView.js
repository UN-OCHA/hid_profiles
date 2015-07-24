var   _ = require('lodash'),
  List = require('../models').List;

function get(req, res, next) {
  // Only find lists that users have access to.
  if (req.query.id) {
    List.findOne({_id:req.query.id, users: req.apiAuth.userId }, function(err, list){
      if (err) {
        return res.json({status: "error", message: "There was an error retrieving the custom contact list."});
      }
      res.json({ status: "ok", lists: list });
    });
  } else {
    List.find({users: req.apiAuth.userId }, function(err, lists){
      if (err) {
        return res.json({status: "error", message: "There was an error retrieving the custom contact lists."});
      }
      res.json({ status: "ok", lists: lists });
    });
  }
}

exports.get = get;
