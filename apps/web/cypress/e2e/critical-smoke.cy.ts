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
    cy.intercept(
      "POST",
      `${API_URL}/api/v1/chat/rooms/${room.id}/messages`,
      (request) => {
        request.reply({
          statusCode: 201,
          body: {
            success: true,
            data: {
              message: {
                id: "cmqd06xfa0000cn13o3jjb021",
                roomId: room.id,
                content: request.body.content,
                type: "TEXT",
                replyTo: null,
                isEdited: false,
                isDeleted: false,
                createdAt: "2026-06-14T01:03:00.000Z",
                updatedAt: "2026-06-14T01:03:00.000Z",
                sender: alice,
              },
            },
          },
        });
      },
    ).as("sendRoomFallback");
    cy.intercept("POST", `${API_URL}/api/v1/reports`, {
      statusCode: 201,
      body: {
        success: true,
        data: { report: { id: "cmqd06xfa0000cn13o3jjb030" } },
      },
    }).as("createReport");
    cy.intercept("GET", `${API_URL}/api/v1/reports/mine`, {
      success: true,
      data: {
        reports: [
          {
            id: "cmqd06xfa0000cn13o3jjb030",
            type: "SCAM",
            reason: "This message appears to be a financial scam.",
            evidence: `room:${room.name}\nmessage:cmqd06xfa0000cn13o3jjb020\nexcerpt:Send money to unlock a special prize.`,
            status: "UNDER_REVIEW",
            resolution: null,
            createdAt: "2026-06-14T01:05:00.000Z",
            resolvedAt: null,
            reported: bobby,
          },
        ],
      },
    }).as("myReports");
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
    cy.intercept(
      "POST",
      `${API_URL}/api/v1/chat/private/${bobby.id}/messages`,
      (request) => {
        request.reply({
          statusCode: 201,
          body: {
            success: true,
            data: {
              message: {
                id: "cmqd06xfa0000cn13o3jjb040",
                senderId: alice.id,
                receiverId: bobby.id,
                content: request.body.content,
                type: "TEXT",
                isRead: false,
                createdAt: "2026-06-14T01:10:00.000Z",
                sender: alice,
                receiver: bobby,
              },
            },
          },
        });
      },
    ).as("sendDirectFallback");
    cy.intercept("GET", `${API_URL}/api/v1/users/me`, {
      success: true,
      data: {
        user: {
          ...alice,
          avatar: null,
          language: "en",
          country: null,
          status: "ONLINE",
          emailVerified: false,
          createdAt: "2026-06-14T00:00:00.000Z",
          profile: {
            displayName: null,
            bio: null,
            activity: null,
            theme: "system",
            subscriptionTier: "FREE",
          },
        },
      },
    }).as("account");
    cy.intercept("PATCH", `${API_URL}/api/v1/users/me`, (request) => {
      request.reply({
        success: true,
        data: {
          user: {
            ...alice,
            avatar: null,
            language: request.body.language,
            country: request.body.country,
            status: "ONLINE",
            emailVerified: false,
            createdAt: "2026-06-14T00:00:00.000Z",
            profile: {
              displayName: request.body.displayName,
              bio: request.body.bio,
              activity: request.body.activity,
              theme: "system",
              subscriptionTier: "FREE",
            },
          },
        },
      });
    }).as("updateAccount");
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
    cy.get('textarea[aria-label="Message"]').type(
      "Saved even while live delivery reconnects.",
    );
    cy.get('button[aria-label="Send message"]').click();
    cy.wait("@sendRoomFallback");
    cy.contains("Saved even while live delivery reconnects.").should(
      "be.visible",
    );

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

    cy.contains("button", "Safety").click();
    cy.wait("@myReports");
    cy.contains("h2", "Safety center").should("be.visible");
    cy.contains("strong", "@bobby").should("be.visible");
    cy.contains("A moderator is reviewing this").should("be.visible");

    cy.contains("button", "Direct").click();
    cy.wait("@directConversations");
    cy.get('input[aria-label="Find a user by username"]').type("bob");
    cy.get('button[aria-label="Search users"]').click();
    cy.wait("@searchUsers");
    cy.contains("button", "@bobby").click();
    cy.wait(["@directMessages", "@markRead"]);
    cy.contains("h2", "@bobby").should("be.visible");
    cy.get('textarea[aria-label="Message bobby"]').type(
      "This direct message uses the fallback.",
    );
    cy.get('button[aria-label="Send private message to bobby"]').click();
    cy.wait("@sendDirectFallback");
    cy.contains("This direct message uses the fallback.").should("be.visible");

    cy.get("button.user-chip").click();
    cy.wait("@account");
    cy.contains("h2", "Your profile").should("be.visible");
    cy.get('input[placeholder="The name people know you by"]').type("Alice A.");
    cy.get('textarea[placeholder="Share a short introduction."]').type(
      "I enjoy welcoming thoughtful communities.",
    );
    cy.contains("button", "Save profile").click();
    cy.wait("@updateAccount");
    cy.contains("Your profile was updated.").should("be.visible");
  });

  it("prioritizes sign-in and stays within the mobile viewport", () => {
    cy.viewport(390, 844);
    cy.visit("/");
    cy.wait("@rooms");

    cy.get(".auth-card").should("be.visible");
    cy.get(".welcome-panel").then(($welcome) => {
      cy.get(".room-rail").then(($rail) => {
        expect($welcome[0].getBoundingClientRect().top).to.be.lessThan(
          $rail[0].getBoundingClientRect().top,
        );
      });
    });

    cy.get(".workspace-switch button").each(($button) => {
      expect($button[0].getBoundingClientRect().height).to.be.at.least(44);
    });

    cy.document().then((document) => {
      expect(document.documentElement.scrollWidth).to.be.at.most(
        document.documentElement.clientWidth + 1,
      );
    });
  });
});
