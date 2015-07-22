var List = require('../models').List;

function post(req, res, next) {
  // TODO: Add support for adding contacts in a later ticket.
  // TODO: Add access permissions in a later ticket.
  // If an id exists then update the contact list.
  if (req.body._id) {
    List.findById(req.body._id, function(err, list){
      if (err) {
        return res.json({status: "error", message: "Could not update contact list."});
      }

      list.name = req.body.name;
      list.users = req.body.users;
      list.contacts = req.body.contacts;

      list.save(function(err){
        if (err) {
          return res.json({status: "error", message: "Could not update contact list."});
        }
        res.json({ status: "ok", message: "Contact list updated" });
      });
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
