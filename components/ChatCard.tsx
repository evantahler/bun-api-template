import { Row, Col, Form, Button, Table } from "react-bootstrap";
import type { AppUser } from "./App";
import type { ActionResponse } from "../api";
import type { MessagesList } from "../actions/message";
import { useEffect, useState } from "react";
import pkg from "../package.json";

let ws: WebSocket;
let messageCounter = 0;

export default function ChatCard({
  user,
  setSuccessMessage,
  setErrorMessage,
}: {
  user: AppUser;
  setSuccessMessage: React.Dispatch<React.SetStateAction<string | null>>;
  setErrorMessage: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const [messages, setMessages] = useState<
    ActionResponse<MessagesList>["messages"]
  >([]);
  const [connected, setConnected] = useState<boolean>(false);

  function connect() {
    ws = new WebSocket(window.location.origin, pkg.name); // connect to the server hosting *this* page.  We use the protocol to ensure that we distinguish the 'application' websocket from the next.js hot-reloading websocket

    // Connection opened
    ws.addEventListener("open", (event) => {
      console.log("Websocket connected");
      ws.send(
        JSON.stringify({ messageType: "subscribe", channel: "messages" }),
      );
      setConnected(true);
    });

    // Listen for messages
    ws.addEventListener("message", (event) => {
      const response = JSON.parse(event.data);
      console.log("Message from server: ", response);

      if (response.error) setErrorMessage(response.error.message);
      if (response.message && response.message.channel === "messages") {
        setMessages((prevMessages) => {
          const newMessages = [
            response.message.message.message as (typeof messages)[number],
            ...prevMessages,
          ]
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 10);
          return newMessages;
        });
      }
    });
  }

  async function sendMessage(event: React.SyntheticEvent) {
    event.preventDefault();
    if (!connected) return setErrorMessage("websocket not connected");

    const target = event.target as typeof event.target & {
      body: { value: string };
    };

    messageCounter++;

    ws.send(
      JSON.stringify({
        messageType: "action",
        action: "message:create",
        messageId: messageCounter,
        params: { body: target.body.value },
      }),
    );

    //@ts-ignore
    event.target.reset();
  }

  async function loadMessages() {
    const response = (await fetch("/api/messages/list").then((res) =>
      res.json(),
    )) as ActionResponse<MessagesList>;

    if (response.error) {
      setErrorMessage(response.error.message);
    } else {
      setMessages(response.messages);
    }
  }

  useEffect(() => {
    connect();
    loadMessages(); // load the messages that happened before we joined
    // setInterval(loadMessages, 5000);
  }, []);

  return (
    <>
      <Row>
        <Col>
          <Form onSubmit={sendMessage}>
            <Form.Group className="mb-3" controlId="body">
              <Form.Label>Message</Form.Label>
              <Form.Control type="text" placeholder="Message" />
            </Form.Group>

            <Button variant="primary" type="submit" disabled={!connected}>
              Send
            </Button>
          </Form>
        </Col>
      </Row>

      <hr />

      <Row>
        <Table striped bordered hover>
          <thead>
            <tr>
              <th>Who</th>
              <th>When</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((message) => (
              <tr key={message.id}>
                <td>{message.user_name}</td>
                <td>{formatDate(message.createdAt)}</td>
                <td>{message.body}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Row>
    </>
  );
}

function formatDate(t: number) {
  const d = new Date(t);
  const s =
    d.getUTCFullYear() +
    "-" +
    ("00" + (d.getUTCMonth() + 1)).slice(-2) +
    "-" +
    ("00" + d.getUTCDate()).slice(-2) +
    " " +
    ("00" + d.getUTCHours()).slice(-2) +
    ":" +
    ("00" + d.getUTCMinutes()).slice(-2) +
    ":" +
    ("00" + d.getUTCSeconds()).slice(-2);

  return s;
}
