var Contact = require('../models').Contact;

function get(req, res, next) {
  var docs = {},
    query = {},
    contactModel = (new Contact(req.query)).toObject();

  for (var prop in req.query) {
    if (req.query.hasOwnProperty(prop) && req.query[prop]) {
      var val = typeof req.query[prop] === 'String' ? req.query[prop] : String(req.query[prop]);
      if (!val || !val.length) {
        continue;
      }

      if (prop == '_id' || prop == '_profile') {
        query[prop] = val;
      }
      else if (prop == 'text') {
        query['$or'] = [
          {jobtitle: new RegExp(val, "i")},
          {nameGiven: new RegExp(val, "i")},
          {nameFamily: new RegExp(val, "i")},
          {'organization.name': new RegExp(val, "i")}
        ];
      }
      else if (contactModel.hasOwnProperty(prop)) {
        query[prop] = val;
      }
    }
  }

  var result = {},
    contacts = [];

  Contact.find(query).sort({nameGiven: 1, nameFamily: 1}).populate('_profile').exec(function (err, _contacts) {
    if (err) {
      console.dir(err);
      result = {status: "error", message: "Query failed for contacts."};
    }
    else {
      if (_contacts && _contacts.length) {
        contacts = _contacts;

        if (req.query.hasOwnProperty("verified") && req.query.verified) {
          contacts = _contacts.filter(function (item) {
            return item._profile && item._profile.verified;
          });
        }
      }
      result = {status: "ok", contacts: contacts};
    }
    res.send(result);
    next();
  });
}

exports.get = get;
