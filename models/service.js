var mongoose = require('mongoose'),
    Profile = require('../models').Profile,
    google = require('googleapis'),
    googleAuth = require('google-auth-library'),
    mcapi = require('../node_modules/mailchimp-api/mailchimp'),
    ServiceCredentials = require('../models').ServiceCredentials;

var Schema = mongoose.Schema;

var validType = {
  values: 'mailchimp googlegroup'.split(' '),
  message: '{VALUE} is not a valid service type.'
};

var serviceSchema = new Schema({
  name:     {type: String, required: true},
  userid:   {type: String, required: true},
  type:     {type: String, required: true, enum: validType},
  mc_api_key: {type: String},
  mc_list: { id: String, name: String},
  googlegroup: {
    domain: { type: String },
    group: { id: String, name: String }
  },
  status: { type: Boolean, default: true},
  hidden: { type: Boolean, default: false},
  auto_add: { type: Boolean, default: false},
  auto_remove: { type: Boolean, default: false},
  locations: [ { name: String, remote_id: String } ],
  owners: [ { type: Schema.Types.ObjectId, ref: 'Profile' } ]
});

serviceSchema.pre('remove', function (next) {
  Profile.find({'subscriptions.service': this }, function (err, profiles) {
    if (err) {
      return next(err);
    }
    if (!profiles.length) {
      return next();
    }
    profiles.each(function (err2, profile) {
      if (!err2 && profile && profile.subscriptions && profile.subscriptions.length) {
        var index = -1;
        for (var i = 0; i < profile.subscriptions.length; i++) {
          if (profile.subscriptions[i].service.equals(this._id)) {
            index = i;
          }
        }
        profile.subscriptions.splice(index, 1);
        profile.save();
      }
      else {
        return next(err2);
      }
    });
    return next();
  });
});


// Sanitize service before presenting it to non admin users
serviceSchema.methods.sanitize = function() {
  this.mc_api_key = undefined;
};

// Subscribe email to a service
serviceSchema.methods.subscribe = function (profile, email, vars, onresult, onerror) {
  if (!profile.subscriptions) {
    profile.subscriptions = [];
  }

  var that = this;

  if (this.type === 'mailchimp') {
    var mc = new mcapi.Mailchimp(this.mc_api_key);
    return mc.lists.subscribe({id: this.mc_list.id, email: {email: email}, merge_vars: vars, double_optin: false}, function (data) {
      profile.subscriptions.push({ service: that, email: email});
      profile.save();
      return onresult(email);
    }, function (err) {
      if (err.name === 'List_AlreadySubscribed') {
        profile.subscriptions.push({ service: that, email: email });
        profile.save();
        return onresult();
      }
      else {
        return onerror(new Error(err.error));
      }
    });
  }
  else if (service.type === 'googlegroup') {
    // Subscribe email to google group
    ServiceCredentials.findOne({ type: 'googlegroup', 'googlegroup.domain': this.googlegroup.domain}, function (err, creds) {
      if (err) {
        return onerror(new Error(err));
      }
      if (!creds) {
        return onerror(new Error('Invalid domain'));
      }
      googleGroupsAuthorize(creds.googlegroup, function (auth) {
        var gservice = google.admin('directory_v1');
        gservice.members.insert({
          auth: auth,
          groupKey: that.googlegroup.group.id,
          resource: { 'email': email, 'role': 'MEMBER' }
        }, function (err, response) {
          if (!err || (err && err.code === 409)) {
            profile.subscriptions.push({ service: that, email: email});
            profile.save();
            return onresult(email);
          }
         else {
           return onerror(new Error(err));
          }
        });
      });
    });
  }
  else {
    return onerror(new Error('Invalid service type'));
  }
};

// Unsubscribe wrapper
serviceSchema.methods.unsubscribe = function (profile, onresult, onerror) {
  var that = this;
  var index = -1;
  for (var i = 0; i < profile.subscriptions.length; i++) {
    if (profile.subscriptions[i].service.equals(this._id)) {
      index = i;
    }
  }
  if (index === -1) {
    return onerror(new Error('No subscription found'));
  }

  if (this.type === 'mailchimp') {
    var mc = new mcapi.Mailchimp(this.mc_api_key);
    return mc.lists.unsubscribe({id: this.mc_list.id, email: {email: profile.subscriptions[index].email}}, function (data) {
      var email = profile.subscriptions[index].email;
      profile.subscriptions.splice(index, 1);
      profile.save();
      return onresult(email);
    }, function (err) {
      if (err.name === 'Email_NotExists' || err.name === 'List_NotSubscribed') {
        var email = profile.subscriptions[index].email;
        profile.subscriptions.splice(index, 1);
        profile.save();
        return onresult();
      }
      else {
        return onerror(new Error(err.error));
      }
    });
  }
  else if (this.type === 'googlegroup') {
    // Unsubscribe user from google group
    ServiceCredentials.findOne({ type: 'googlegroup', 'googlegroup.domain': this.googlegroup.domain}, function (err, creds) {
      if (err) {
        return onerror(new Error(err));
      }
      if (!creds) {
        return onerror(new Error('Invalid domain'));
      }
      googleGroupsAuthorize(creds.googlegroup, function (auth) {
        var gservice = google.admin('directory_v1');
        gservice.members.delete({
          auth: auth,
          groupKey: that.googlegroup.group.id,
          memberKey: profile.subscriptions[index].email
        }, function (err, response) {
          if (!err || (err && err.code === 404)) {
            var email = profile.subscriptions[index].email;
            profile.subscriptions.splice(index, 1);
            profile.save();
            return onresult(email);
          }
          else {
            return onerror(new Error(err));
          }
        });
      });
    });
  }
  else {
    return onerror(new Error('Invalid service type'));
  }
};



mongoose.model('Service', serviceSchema);

var Service = mongoose.model('Service');
module.exports = Service;
