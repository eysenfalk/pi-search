const mod = require("./dist/index.js");

const factory = mod && (mod.default || mod);

module.exports = factory;
module.exports.default = factory;
if (mod && mod.__testables) {
  module.exports.__testables = mod.__testables;
}
