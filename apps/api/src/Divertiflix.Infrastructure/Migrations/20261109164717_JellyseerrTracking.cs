using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Divertiflix.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class JellyseerrTracking : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SeerrMediaType",
                table: "Requests",
                type: "character varying(10)",
                maxLength: 10,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SeerrNote",
                table: "Requests",
                type: "character varying(300)",
                maxLength: 300,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SeerrRequestId",
                table: "Requests",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SeerrState",
                table: "Requests",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SeerrTmdbId",
                table: "Requests",
                type: "integer",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SeerrMediaType",
                table: "Requests");

            migrationBuilder.DropColumn(
                name: "SeerrNote",
                table: "Requests");

            migrationBuilder.DropColumn(
                name: "SeerrRequestId",
                table: "Requests");

            migrationBuilder.DropColumn(
                name: "SeerrState",
                table: "Requests");

            migrationBuilder.DropColumn(
                name: "SeerrTmdbId",
                table: "Requests");
        }
    }
}
