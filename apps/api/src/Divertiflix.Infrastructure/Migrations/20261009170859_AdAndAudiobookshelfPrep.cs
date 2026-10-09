using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Divertiflix.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AdAndAudiobookshelfPrep : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "DirectorySyncedAt",
                table: "Users",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsActive",
                table: "Users",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<string>(
                name: "Source",
                table: "Users",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Author",
                table: "Titles",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ExternalId",
                table: "Titles",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ExternalSource",
                table: "Titles",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Narrator",
                table: "Titles",
                type: "text",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Titles_ExternalSource_ExternalId",
                table: "Titles",
                columns: new[] { "ExternalSource", "ExternalId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Titles_ExternalSource_ExternalId",
                table: "Titles");

            migrationBuilder.DropColumn(
                name: "DirectorySyncedAt",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "IsActive",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "Source",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "Author",
                table: "Titles");

            migrationBuilder.DropColumn(
                name: "ExternalId",
                table: "Titles");

            migrationBuilder.DropColumn(
                name: "ExternalSource",
                table: "Titles");

            migrationBuilder.DropColumn(
                name: "Narrator",
                table: "Titles");
        }
    }
}
