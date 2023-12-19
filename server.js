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
    // Get history from the request or initialize it
    const messageHistory = req.body.messageHistory || [];

    // Add the user's message to the history
    messageHistory.push({ role: 'user', content: userMessage });

    const stream = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: messageHistory,
      stream: true,
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Aggregates the assistant's response
    let assistantResponse = '';

    for await (const chunk of stream) {
      if (chunk.choices[0]?.delta?.content) {
        const part = chunk.choices[0].delta.content;
        assistantResponse += part;
        res.write(`data: ${part}\n\n`);
      }
    }

    // Add the complete assistant's response to the history
    messageHistory.push({
      role: 'assistant',
      content: assistantResponse.trim(),
    });

    // Ensure the history doesn't exceed 20 messages after adding the assistant's response
    while (messageHistory.length > 20) {
      messageHistory.shift();
    }

    // Send the full message history after the stream ends
    res.write(
      `data: ${JSON.stringify({ completeHistory: messageHistory })}\n\n`
    );
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
