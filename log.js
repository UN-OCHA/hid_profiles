var bunyan = require("bunyan"),
  log = bunyan.createLogger({
    name: 'contactsid_profiles',
    serializers: {
      req: bunyan.stdSerializers.req
    },
    streams: [
      {
        level: 'info',
        stream: process.stdout
      },
      {
        level: 'info',
        path: '/var/log/hid_profiles.log'
      }
    ]
  });

module.exports = log;
