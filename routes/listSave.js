var async = require('async'),
  List = require('../models').List;

function post(req, res, next) {
  // TODO: Add support for adding contacts in a later ticket.
  // TODO: Add access permissions in a later ticket.
  // If an id exists then update the contact list.
  if (req.body._id) {
    var updatedList = {};

    async.series([
      function(cb) {
        List.findById(req.body._id, function(err, list){
          if (err) {
            return cb(err);
          }

          updatedList = list;
          cb();
        });
      },
      function(cb) {
        updatedList.name = req.body.name;
        updatedList.users = req.body.users;
        updatedList.contacts = req.body.contacts;

        updatedList.save(function(err){
          if (err) {
            return cb(err);
          }
          cb();
        });
      }
    ], function(err) { //This function gets called after the two tasks have called their "task callbacks"
      if (err) {
        return res.json({status: "error", message: "Could not update contact list."});
      }
      return res.json({status: "ok", message: "Contact list updated."});
    });
  } else {
    list = new List();
    list.name = req.body.name;
    list.userid = req.apiAuth.userId;
    list.users = [req.apiAuth.userId];
    list.contacts = req.body.contacts;

    list.save(function(err) {
      if (err) {
        return res.json({status: "error", message: "Could not save contact list."});
      }
      res.json({ status: 'ok', message: "List saved" });
    });
  }
}

exports.post = post;
