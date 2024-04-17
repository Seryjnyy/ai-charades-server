# ai-charades-server

ai-charades is a web-based game inspired by Charades that uses OpenAI's DALL-E for image generation.

This is the server for ai-charades. The client can be found [here](https://github.com/Seryjnyy/ai-charades-client).

<!-- TABLE OF CONTENTS -->
<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about">About</a>
      <ul>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#status">Status</a></li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#with-docker">With Docker</a></li>
        <li><a href="#locally">Locally</a>
        <ul>
         <li><a href="#for-development">For development</a></li>
         <li><a href="#locally">Just running it</a></li>
        </ul>
        </li>
      </ul>
    </li>
  </ol>
</details>

## About

AI is here to stay, so why not learn to use it better? A part of that is prompting. The better your prompts, the better your results.

That is why the game forces the users to create prompts to explain certain things, like cartoon characters, without using key words.

You have to get crafty to explain it properly to get an image that the other user will get.

The game involves two rounds.

- First round is about creating prompts for topics that you got.
- Second round is when you get the other players generated images and guess the topic.
- Finally, you get the results to see how everyone got on.

### Built with

- OpenAI
- Node.JS
- Socket.io
- Express
- DyanomDB
- Winston

## Status

The main game features are all there.

The codebase, however, is not cleaned up or refactored yet. Apologies.

If you find bugs or issues, do let me know.

## Usage

You can set up and host both the server and the client if you want to. This will allow you to use your own OpenAI key.

## Getting started

- You can run it locally or use the Docker container.

- You will need to create a .env file in the root folder to connect OpenAI and AWS.

  ```
  OPENAI_API_KEY=

  AWS_ACCESS_KEY_ID=
  AWS_SECRET_ACCESS_KEY=
  ```

  - You will need to create an OpenAI account to get an API key.
  - You also need an AWS account and an IAM user with DynamoDB Read and Write permissions.
  - Then you can add the keys to the .env file.

- The server uses HTTPS, so you will also need to have a cert.pem and key.pem file. You will need a legitimate certificate; otherwise, the server will be deemed unsecure.
  - A workaround is to have the user allow the unsafe source first.

### With Docker

- You will need [Docker](https://docs.docker.com/get-docker/) installed.

- You can use Compose to build and launch the container.
  ```
     docker compose up --build
  ```
  - Note: dockerfile is set up to use port 443 for HTTPS and so is the http server.

### Locally

- You will need Node installed.

#### For development

- Run it locally.
  ```
  npm run dev
  ```
  - This will use nodemon for automatic app restarts on changes.

#### Just running it

- Start the server.
  ```
  npm run start
  ```
