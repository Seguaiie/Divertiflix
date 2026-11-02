using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Divertiflix.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AudiobookshelfAccounts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AudiobookshelfAccounts",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    AbsUserId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    AbsUsername = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    ApiKeyProtected = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AudiobookshelfAccounts", x => x.UserId);
                    table.ForeignKey(
                        name: "FK_AudiobookshelfAccounts_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AudiobookshelfAccounts");
        }
    }
}
