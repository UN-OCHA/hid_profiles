var Contact = require('../models').Contact;

function get(req, res, next) {
  var docs = {},
    query = {},
    contactSchema = Contact.schema.paths;

  for (var prop in req.query) {
    if (req.query.hasOwnProperty(prop) && req.query[prop]) {
      var val = typeof req.query[prop] === 'String' ? req.query[prop] : String(req.query[prop]);
      if (!val || !val.length) {
        continue;
      }

      var propArray = prop.split('.');
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
      else if (recusiveSchemaCheck(contactSchema, propArray)) {
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

  // Recursively check schema for properties in array.
  function recusiveSchemaCheck(schema, propArray) {
    var prop = propArray.shift();
    if (schema.hasOwnProperty(prop)) {
      if (propArray.length  && schema[prop].hasOwnProperty('schema')) {
        return recusiveSchemaCheck(schema[prop].schema.paths ,propArray);
      }
      else {
        return true;
      }
    }
    else {
      return false;
    }
  }
}

exports.get = get;
