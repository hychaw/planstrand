const { version } = require('../planstrand-product.json');

if (!/^\d+\.\d+\.\d+(?:-rc\.\d+)?$/.test(version)) {
  throw new Error('Invalid Planstrand product version');
}

// Keep the source package version for upstream tooling/compatibility, while
// Electron, installer and executable metadata identify the Planstrand product.
module.exports = {
  extraMetadata: { version },
  buildVersion: version.split('-')[0],
};
