var operations = require('./lib/operations'),
  bundles = require('./lib/bundles'),
  offices = require('./lib/offices'),
  protectedRoles = require('./lib/protectedRoles'),
  orgTypes = require('./lib/orgTypes'),
  disasters = require('./lib/disasters'),
  contacts = require('./lib/contacts'),
  async = require('async');

async.auto({
  operations: operations.buildCache,
  bundles: bundles.fetchBundles,
  offices: offices.fetchOffices,
  protectedRoles: protectedRoles.buildCache,
  orgTypes: orgTypes.buildCache,
  disasters: ['operations', disasters.buildCache],
  contacts: contacts.sendReminderCheckoutEmails,
  checkout: contacts.doAutomatedCheckout,
  appData: ['operations', 'bundles', 'offices', 'protectedRoles', 'orgTypes', 'disasters', 'contacts', 'checkout', operations.buildAppData]
},
function (err, results) {
  if (err) {
    console.log("hid_profiles cron run failed.");
  }
  else {
    console.log("Finished hid_profiles cron run successfully.");
  }
  process.exit(err ? 1 : 0);
});
