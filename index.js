import Fastify from 'fastify';
import crypto from 'crypto';
import multiform from '@fastify/formbody';
import multipart from '@fastify/multipart';
import axios from 'axios';
import * as dotenv from 'dotenv'
import AsyncLock from 'async-lock';

dotenv.config();

// Require the framework and instantiate it
const fastify = Fastify({
    logger: true
})

import Database from 'better-sqlite3';
const db = new Database('chat.db');
db.pragma('journal_mode = WAL');
db.pragma('synchronous = FULL')

const lock = new AsyncLock();

fastify.register(multiform);
fastify.register(multipart, { addToBody: true });

//init table
const table = db.prepare("SELECT count(*) FROM sqlite_master WHERE type='table' AND name = 'chat';").get();
if (!table['count(*)']) {
    // If the table isn't there, create it and setup the database correctly.
    db.prepare("CREATE TABLE chat (hash TEXT PRIMARY KEY, timestamp INTEGER);").run();
    // Ensure that the "id" row is always unique and indexed.
    db.prepare("CREATE UNIQUE INDEX idx_chat_id ON chat (hash);").run();
    db.pragma("synchronous = 1");
    db.pragma("journal_mode = wal");
}

// setup prepared statements
const getChat = db.prepare("SELECT * FROM chat WHERE hash = ?");
const setChat = db.prepare("INSERT INTO chat (hash, timestamp) VALUES (@hash, @timestamp);");

// Declare a route
fastify.post('/webhook', async (request, reply) => {
    lock.acquire('lock', function() {
        console.log('lock aqcuired');
        const message = JSON.parse(request.body.data);
        const hash = crypto.createHash('sha1').update(request.body.data).digest('base64');

        let chatExists = getChat.get(hash);
        if(chatExists) {
            return { dupe: 'true'};
        }

        const chatObject = {
            hash: hash,
            timestamp: message.timestamp
        };
        setChat.run(chatObject);

        let messageToSend;

        if (message.broadcast) {
            messageToSend = message.content;
        } else {
            messageToSend = `**${message.author}**: ${message.content}`
        }

        axios.post(process.env.WEBHOOK_URL, {
            content: messageToSend
        }).then((res) => {
            return { dupe: 'false'}
        })
    }, function(err, ret) {
        console.log('lock released');
    });
})

const start = async () => {
    try {
        await fastify.listen({port: process.env.APPLICATION_PORT})
    } catch (err) {
        fastify.log.error(err)
        process.exit(1)
    }
}
start()
