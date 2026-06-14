const API_URL = "http://localhost:4000";

const alice = {
  id: "cmqd06xfa0000cn13o3jjb001",
  email: "alice@example.test",
  username: "alice",
  role: "USER",
};

const bobby = {
  id: "cmqd06xfa0000cn13o3jjb002",
  username: "bobby",
  avatar: null,
  status: "ONLINE",
};

const room = {
  id: "cmqd06xfa0000cn13o3jjb010",
  name: "Open Table",
  slug: "open-table",
  description: "A public place for thoughtful conversation.",
  type: "PUBLIC",
  language: "en",
  category: "Community",
  maxUsers: 50,
  memberCount: 8,
  createdAt: "2026-06-14T00:00:00.000Z",
};

describe("critical signed-in journey", () => {
  beforeEach(() => {
    cy.intercept("GET", `${API_URL}/api/v1/chat/rooms*`, {
      success: true,
      data: [room],
    }).as("rooms");
    cy.intercept("POST", `${API_URL}/api/v1/auth/login`, {
      success: true,
      data: {
        user: alice,
        accessToken: "e2e-access-token",
        refreshToken: "e2e-refresh-token",
      },
    }).as("login");
    cy.intercept("POST", `${API_URL}/api/v1/chat/rooms/${room.id}/join`, {
      success: true,
      data: { roomId: room.id },
    }).as("joinRoom");
    cy.intercept("GET", `${API_URL}/api/v1/chat/rooms/${room.id}/messages*`, {
      success: true,
      data: {
        messages: [
          {
            id: "cmqd06xfa0000cn13o3jjb020",
            roomId: room.id,
            content: "Send money to unlock a special prize.",
            type: "TEXT",
            replyTo: null,
            isEdited: false,
            isDeleted: false,
            createdAt: "2026-06-14T01:00:00.000Z",
            updatedAt: "2026-06-14T01:00:00.000Z",
            sender: bobby,
          },
        ],
        nextCursor: null,
      },
    }).as("roomMessages");
    cy.intercept("POST", `${API_URL}/api/v1/reports`, {
      statusCode: 201,
      body: {
        success: true,
        data: { report: { id: "cmqd06xfa0000cn13o3jjb030" } },
      },
    }).as("createReport");
    cy.intercept("GET", `${API_URL}/api/v1/chat/private/conversations`, {
      success: true,
      data: { conversations: [] },
    }).as("directConversations");
    cy.intercept("GET", `${API_URL}/api/v1/users/search?q=bob`, {
      success: true,
      data: { users: [bobby] },
    }).as("searchUsers");
    cy.intercept(
      "GET",
      `${API_URL}/api/v1/chat/private/${bobby.id}/messages*`,
      {
        success: true,
        data: { user: bobby, messages: [], nextCursor: null },
      },
    ).as("directMessages");
    cy.intercept("POST", `${API_URL}/api/v1/chat/private/${bobby.id}/read`, {
      success: true,
      data: { updatedCount: 0 },
    }).as("markRead");
  });

  it("signs in, opens a room, reports a message, and starts a direct chat", () => {
    cy.visit("/");
    cy.wait("@rooms");

    cy.get('input[type="email"]').type(alice.email);
    cy.get('input[type="password"]').type("StrongPass1!");
    cy.contains("button", "Enter ZestChat").click();
    cy.wait("@login");
    cy.contains("strong", "alice").should("be.visible");

    cy.contains("button", "Open Table").click();
    cy.wait(["@joinRoom", "@roomMessages"]);
    cy.contains("Send money to unlock a special prize.").should("be.visible");

    cy.get('button[aria-label="Report message from bobby"]').click();
    cy.get('[role="dialog"][aria-labelledby="report-dialog-title"]').within(
      () => {
        cy.get("select").select("SCAM");
        cy.get("textarea").type("This message appears to be a financial scam.");
        cy.contains("button", "Send report").click();
      },
    );
    cy.wait("@createReport");
    cy.contains("Thanks. The safety team will review your report.").should(
      "be.visible",
    );

    cy.contains("button", "Direct").click();
    cy.wait("@directConversations");
    cy.get('input[aria-label="Find a user by username"]').type("bob");
    cy.get('button[aria-label="Search users"]').click();
    cy.wait("@searchUsers");
    cy.contains("button", "@bobby").click();
    cy.wait(["@directMessages", "@markRead"]);
    cy.contains("h2", "@bobby").should("be.visible");
    cy.get('textarea[aria-label="Message bobby"]').should("be.visible");
  });
});
