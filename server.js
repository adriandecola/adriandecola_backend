// adriandecola_backend/server.js

import express from 'express';
import OpenAI from 'openai';
import dotenv from 'dotenv';

const app = express();
const port = 4000;

// Enviroment Variables config
dotenv.config();

// Middleware
app.use(express.json());

// openai config
const openai = new OpenAI(process.env.OPENAI_API_KEY);

/////////////////// Routes ///////////////////
// Route to hit for chat requests
app.post('/chat', async (req, res) => {
  try {
    const userMessage = req.body.message;
    const stream = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: userMessage }],
      stream: true,
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    for await (const chunk of stream) {
      if (chunk.choices[0]?.delta?.content) {
        res.write(`data: ${chunk.choices[0].delta.content}\n\n`);
      }
    }

    res.end();
  } catch (error) {
    console.error(error);
    res.status(500).send(error.message);
  }
});

// Starting the server
app.listen(port, 'localhost', () => {
  console.log(`Server listening on port: ${port}`);
});
