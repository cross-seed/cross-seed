"use strict";
const fs = require("fs");
const { encode, decode } = require("bencode");
const resume = require("./fastResume");
const datapath = process.argv[2];
const data = fs.readFileSync("/dev/stdin");
const withResumeEncoded = encode(resume(decode(data), datapath));
fs.writeFileSync("/dev/stdout", withResumeEncoded);
