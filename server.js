// adriandecola_backend/server.js

import express from 'express';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import cors from 'cors';

const app = express();
const port = 4000;

// Enviroment Variables config
dotenv.config();

// CORS config
var corsOptions = {
  origin: 'https://chat.adriandecola.com',
  optionsSuccessStatus: 200, // For legacy browser support
};

/////// Middleware
app.use(express.json());
app.use(cors(corsOptions));

// testing
//

/////// openai configs
// used for personal website on digital oceans
const openai_personal = new OpenAI({
  organization: process.env.OPENAI_PERSONAL_ORG,
  apiKey: process.env.OPENAI_API_KEY_PERSONAL_DO_SERVER,
});

// used for Meta Carbon's assistant
const openai = new OpenAI({
  organization: process.env.OPENAI_META_ORG,
  apiKey: process.env.OPENAI_API_KEY_META_ADRIANS,
});

/////////////////// Routes ///////////////////
// Route to hit for chat requests
app.post('/chat', async (req, res) => {
  try {
    const userMessage = req.body.message;
    // Get history from the request or initialize it
    const messageHistory = req.body.messageHistory || [];

    // Add the user's message to the history
    messageHistory.push({ role: 'user', content: userMessage });

    const stream = await openai_personal.chat.completions.create({
      model: 'ft:gpt-3.5-turbo-1106:personal::8XKVZmJ4',
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
        // Send a complete JSON object
        res.write(`data: ${JSON.stringify({ message: part })}\n\n`);
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

// Route to hit for assistant requests
app.post('/assistant', async (req, res) => {
  // for testing on Postman
  const completion = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [{ role: 'user', content: 'Say this is a test' }],
  });
  res.json({ response: completion.choices[0].message.content });
  /*
  try {
    const userId = req.body.userId; // Assuming user ID is sent in the request
    const userMessage = req.body.userMessage;
    if (!userMessage) {
      return res.status(400).send('No message provided');
    }

    const threadId = await getOrCreateThreadForUser(userId);

    // Add user's message to the thread
    await openai_personal.beta.threads.create(
      {
        messages: [
          {
            role: 'user',
            content: userMessage,
          },
        ],
      },
      threadId
    );

    // Run the assistant
    const run = await openai_personal.beta.threads.runs.create(threadId, {
      assistant_id: 'your_assistant_id', // Replace with your Assistant's ID
    });

    // Retrieve the latest message from the thread, which should be the Assistant's response
    const thread = await openai_personal.beta.threads.retrieve(threadId);
    const assistantMessage =
      thread.messages[thread.messages.length - 1].content;

    // Send back the assistant's response
    res.json({ response: assistantMessage });
  } catch (error) {
    console.error('Error processing message:', error);
    res.status(500).send('Server error');
  }
  */
});

// Test route
app.post('/test', (req, res) => {
  console.log('Test endpoint hit');
  res.json({ message: 'Test response successful' });
});

// Starting the server
app.listen(port, 'localhost', () => {
  console.log(`Server listening on port: ${port}`);
});
