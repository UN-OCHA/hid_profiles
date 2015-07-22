var List = require('../models').List;

function post(req, res, next) {

  list = new List();
  list.name = req.body.name;
  list.userid = req.apiAuth.userId;
  list.contacts = req.body.contacts;

  // TODO: Add support for adding contacts in a later ticket.
  // TODO: Add access permissions in a later ticket.
  list.save(function(err) {
    if (err) {
      return res.json({status: "error", message: "Could not save contact list."});
    }
    res.json({ status: 'ok', message: "List saved" });
  });
}

exports.post = post;
