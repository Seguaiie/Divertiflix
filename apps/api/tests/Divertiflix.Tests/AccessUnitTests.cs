using System.Net;
using System.Security.Claims;
using Divertiflix.Api.Auth;
using Divertiflix.Api.Hubs;
using Divertiflix.Api.Support;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.SignalR;

namespace Divertiflix.Tests;

/// <summary>Horloge réglable à la main : le verrouillage se vérifie sans attendre.</summary>
public sealed class ManualClock : TimeProvider
{
    private DateTimeOffset _now = new(2026, 1, 1, 12, 0, 0, TimeSpan.Zero);
    public override DateTimeOffset GetUtcNow() => _now;
    public void Advance(TimeSpan by) => _now += by;
}

public class LoginThrottleTests
{
    private const string Email = "root";
    private const string Attacker = "203.0.113.9", Owner = "198.51.100.7";

    private static (LoginThrottle Throttle, ManualClock Clock) New()
    {
        var clock = new ManualClock();
        return (new LoginThrottle(clock), clock);
    }

    // Une tentative complète, jugée tout de suite : la réservation et son verdict, comme le fait la connexion.
    private static void Failed(LoginThrottle t, string email, string source)
    {
        using var attempt = t.Begin(email, source, out _);
        attempt?.Failed();
    }

    private static void Succeeded(LoginThrottle t, string email, string source)
    {
        using var attempt = t.Begin(email, source, out _);
        attempt?.Succeeded();
    }

    // Durée à attendre si cette source est refusée, sinon null ; la réservation de contrôle est libérée sans compter.
    private static TimeSpan? LockedFor(LoginThrottle t, string email, string source)
    {
        using var attempt = t.Begin(email, source, out var wait);
        return attempt is null ? wait : null;
    }

    [Fact]
    public void Four_failures_do_not_lock_the_fifth_does_for_thirty_seconds()
    {
        var (t, clock) = New();
        for (var i = 0; i < 4; i++) Failed(t, Email, Attacker);
        Assert.Null(LockedFor(t, Email, Attacker));
        Failed(t, Email, Attacker);
        Assert.Equal(TimeSpan.FromSeconds(30), LockedFor(t, Email, Attacker));
        clock.Advance(TimeSpan.FromSeconds(31));
        Assert.Null(LockedFor(t, Email, Attacker));
    }

    [Fact]
    public void Locks_grow_progressively_up_to_five_minutes_and_never_beyond()
    {
        var (t, clock) = New();
        for (var i = 0; i < 5; i++) Failed(t, Email, Attacker);
        var seen = new List<double> { LockedFor(t, Email, Attacker)!.Value.TotalSeconds };
        for (var i = 0; i < 5; i++)
        {
            clock.Advance(LockedFor(t, Email, Attacker)!.Value + TimeSpan.FromSeconds(1));   // l'attaquant retente dès que le verrou tombe
            Failed(t, Email, Attacker);
            seen.Add(LockedFor(t, Email, Attacker)!.Value.TotalSeconds);
        }
        Assert.Equal([30, 60, 120, 240, 300, 300], seen);
    }

    [Fact]
    public void Attempts_refused_during_a_lock_do_not_extend_it()
    {
        var (t, clock) = New();
        for (var i = 0; i < 5; i++) Failed(t, Email, Attacker);
        clock.Advance(TimeSpan.FromSeconds(10));
        Failed(t, Email, Attacker);   // un client obstiné continue d'insister : refusé, rien n'est compté
        Failed(t, Email, Attacker);
        Assert.Equal(TimeSpan.FromSeconds(20), LockedFor(t, Email, Attacker));
    }

    [Fact]
    public void An_attempt_judged_after_the_lock_was_set_does_not_extend_it()
    {
        var (t, clock) = New();
        Succeeded(t, Email, Owner);
        for (var i = 0; i < 4; i++) Failed(t, Email, Attacker);
        using var fifth = t.Begin(Email, Attacker, out _);   // le cinquième essai de l'attaquant part...
        using var late = t.Begin(Email, Owner, out _);       // ...avec un essai du propriétaire (source connue, jamais refusée)
        fifth!.Failed();                                     // le verrou se pose (30 s)
        clock.Advance(TimeSpan.FromSeconds(10));
        late!.Failed();                                      // jugé pendant le verrou : il ne l'allonge pas
        Assert.Equal(TimeSpan.FromSeconds(20), LockedFor(t, Email, Attacker));
    }

    [Fact]
    public void Failures_older_than_the_window_are_forgotten()
    {
        var (t, clock) = New();
        for (var i = 0; i < 4; i++) Failed(t, Email, Attacker);
        clock.Advance(TimeSpan.FromMinutes(16));
        Failed(t, Email, Attacker);   // la première fenêtre est close : un seul échec compte
        Assert.Null(LockedFor(t, Email, Attacker));
    }

    [Fact]
    public void A_persistent_attacker_is_held_to_a_handful_of_guesses_and_never_blocks_the_owner()
    {
        // L'attaquant retente à chaque seconde pendant 4 h, dès que le verrou le permet. Les verrous (30 s à 5 min) sont courts,
        // mais le propriétaire, dont la source est connue, n'est jamais bloqué : on ne peut pas l'enfermer dehors durablement.
        var (t, clock) = New();
        Succeeded(t, Email, Owner);
        int guesses = 0, ownerBlocked = 0;
        for (var second = 0; second < 4 * 3600; second++)
        {
            if (LockedFor(t, Email, Attacker) is null) { Failed(t, Email, Attacker); guesses++; }
            if (LockedFor(t, Email, Owner) is not null) ownerBlocked++;
            clock.Advance(TimeSpan.FromSeconds(1));
        }
        Assert.Equal(0, ownerBlocked);
        Assert.InRange(guesses, 1, 200);   // quelques dizaines d'essais en 4 h, au lieu de 14 400
    }

    [Fact]
    public void A_known_source_is_never_locked_but_an_unknown_one_is_and_success_lifts_the_lock()
    {
        var (t, _) = New();
        for (var i = 0; i < 5; i++) Failed(t, Email, Attacker);
        Assert.NotNull(LockedFor(t, Email, Attacker));
        Assert.NotNull(LockedFor(t, Email, Owner));   // pas encore connue : verrouillée comme les autres, même avec le bon mot de passe

        var (known, _) = New();
        Succeeded(known, Email, Owner);               // le propriétaire s'est déjà connecté depuis cette source
        for (var i = 0; i < 5; i++) Failed(known, Email, Attacker);
        Assert.NotNull(LockedFor(known, Email, Attacker));
        Assert.Null(LockedFor(known, Email, Owner));  // connue : jamais bloquée par les échecs des autres
        Succeeded(known, Email, Owner);               // elle se reconnecte : le verrou posé par l'attaquant tombe
        Assert.Null(LockedFor(known, Email, Attacker));
    }

    [Fact]
    public void Emails_are_independent_and_only_the_eight_latest_sources_stay_known()
    {
        var (t, _) = New();
        for (var i = 0; i < 5; i++) Failed(t, "autre", Attacker);
        Assert.Null(LockedFor(t, Email, Attacker));
        for (var i = 0; i < 9; i++) Succeeded(t, Email, $"10.0.0.{i}");
        for (var i = 0; i < 5; i++) Failed(t, Email, Attacker);
        Assert.NotNull(LockedFor(t, Email, "10.0.0.0"));   // la plus ancienne a été oubliée
        Assert.Null(LockedFor(t, Email, "10.0.0.8"));
    }

    [Fact]
    public void Attempts_in_flight_count_as_possible_failures_so_a_burst_never_exceeds_the_threshold()
    {
        var (t, _) = New();
        var held = new List<LoginThrottle.Attempt?>();
        for (var i = 0; i < 20; i++) held.Add(t.Begin(Email, Attacker, out _));   // 20 appels arrivent avant qu'aucun mot de passe soit jugé
        Assert.Equal(LoginThrottle.Threshold, held.Count(a => a is not null));
        Assert.Null(t.Begin(Email, Attacker, out var wait));
        Assert.Equal(TimeSpan.FromSeconds(1), wait);
        // Un échec jugé libère sa place en restant compté : il en reste toujours Threshold au plus en tout.
        held.First(a => a is not null)!.Failed();
        Assert.Null(t.Begin(Email, Attacker, out _));
        foreach (var a in held) a?.Dispose();
    }

    [Fact]
    public void A_disposed_attempt_without_a_verdict_is_released_and_counts_for_nothing()
    {
        var (t, _) = New();
        for (var round = 0; round < 10; round++)
        {
            using var attempt = t.Begin(Email, Attacker, out _);   // erreur de base avant le jugement : la réservation est rendue
            Assert.NotNull(attempt);
        }
        for (var i = 0; i < 4; i++) Failed(t, Email, Attacker);
        Assert.Null(LockedFor(t, Email, Attacker));
    }

    [Fact]
    public void An_attempt_judged_twice_is_counted_once()
    {
        var (t, _) = New();
        using (var attempt = t.Begin(Email, Attacker, out _))
        {
            attempt!.Failed();
            attempt.Failed();
        }   // et Dispose derrière : rien de plus
        for (var i = 0; i < 3; i++) Failed(t, Email, Attacker);
        Assert.Null(LockedFor(t, Email, Attacker));   // 4 échecs au total, pas 5
    }

    [Fact]
    public void Parallel_callers_on_one_email_get_exactly_the_threshold_of_reservations()
    {
        var (t, _) = New();
        var start = new Barrier(32);
        var admitted = 0;
        var threads = Enumerable.Range(0, 32).Select(caller => new Thread(() =>
        {
            start.SignalAndWait();
            if (t.Begin(Email, Attacker, out _) is not null) Interlocked.Increment(ref admitted);   // jamais jugée : reste en cours
        })).ToList();
        threads.ForEach(th => th.Start());
        threads.ForEach(th => th.Join());
        Assert.Equal(LoginThrottle.Threshold, admitted);
    }

    [Fact]
    public void Writes_are_never_ignored_when_the_table_is_full_the_oldest_are_forgotten_first()
    {
        var (t, clock) = New();
        Succeeded(t, "habitue@test.com", Owner);   // une source connue : retenue plus longtemps que de simples échecs
        for (var i = 0; i < LoginThrottle.MaxEmails + 5_000; i++)
        {
            Failed(t, $"inconnu{i}@test.com", Attacker);
            if (i % 1000 == 0) clock.Advance(TimeSpan.FromSeconds(1));
        }
        // Courriel neuf alors que la borne est dépassée : ses échecs comptent et le verrouillent quand même.
        for (var i = 0; i < 5; i++) Failed(t, "cible@test.com", Attacker);
        Assert.NotNull(LockedFor(t, "cible@test.com", Attacker));
        Assert.Null(LockedFor(t, "habitue@test.com", Owner));
        for (var i = 0; i < 5; i++) Failed(t, "habitue@test.com", Attacker);
        Assert.NotNull(LockedFor(t, "habitue@test.com", Attacker));   // et son état a été conservé : la source connue y est toujours
        Assert.Null(LockedFor(t, "habitue@test.com", Owner));
    }
}

public class ClientAddressTests
{
    private static string Key(string ip) => ClientAddress.Key(IPAddress.Parse(ip));

    [Fact]
    public void Ipv6_addresses_of_the_same_64_share_one_key_and_other_prefixes_do_not()
    {
        Assert.Equal(Key("2001:db8:abcd:12::2"), Key("2001:db8:abcd:12::61"));
        Assert.Equal(Key("2001:db8:abcd:12::2"), Key("2001:db8:abcd:12:ffff:ffff:ffff:ffff"));
        Assert.NotEqual(Key("2001:db8:abcd:12::2"), Key("2001:db8:abcd:13::2"));
        Assert.EndsWith("/64", Key("2001:db8:abcd:12::2"));
    }

    [Fact]
    public void Ipv4_is_untouched_and_a_mapped_ipv4_is_the_same_client()
    {
        Assert.Equal("203.0.113.9", Key("203.0.113.9"));
        Assert.Equal("203.0.113.9", Key("::ffff:203.0.113.9"));
        Assert.NotEqual(Key("203.0.113.9"), Key("203.0.113.10"));
        Assert.Equal("unknown", ClientAddress.Key(null));
    }
}

public class SafeUrlTests
{
    [Theory]
    [InlineData(null, true)]
    [InlineData("", true)]
    [InlineData("   ", true)]
    [InlineData("http://example.org/a.mp4", true)]
    [InlineData("https://example.org/a/index.m3u8?x=1#t", true)]
    [InlineData("media:demo/index.m3u8", true)]
    [InlineData("media:", false)]
    [InlineData("Media:demo/x", false)]
    [InlineData("javascript:alert(1)", false)]
    [InlineData("https://", false)]
    [InlineData("/api/media/art/x.webp", false)]
    [InlineData("//example.org/x", false)]
    public void Stream_sources_follow_the_allow_list(string? url, bool allowed) => Assert.Equal(allowed, SafeUrl.IsAllowed(url));

    [Theory]
    [InlineData("/api/media/art/x/poster.webp", true)]
    [InlineData("/", true)]
    [InlineData("//example.org/x", false)]
    [InlineData("/\\example.org", false)]
    [InlineData("javascript:alert(1)", false)]
    [InlineData("https://example.org/p.webp", true)]
    public void Images_may_also_use_a_site_path(string url, bool allowed) => Assert.Equal(allowed, SafeUrl.IsAllowed(url, sitePath: true));
}

public class PasswordPolicyTests
{
    [Theory]
    [InlineData("Passw0rd!", "a@test.com")]
    [InlineData("Passw0rd!e2e", "a@test.com")]
    [InlineData("q7Xk!m2P", "a@test.com")]
    [InlineData("boom123$", "root")]
    public void Ordinary_passwords_pass(string password, string email) => Assert.Null(PasswordPolicy.Reject(password, email));

    [Theory]
    [InlineData("password", "a@test.com")]
    [InlineData("Password123", "a@test.com")]
    [InlineData("QWERTYUIOP", "a@test.com")]
    [InlineData("zzzzzzzz", "a@test.com")]
    [InlineData("marie.curie@test.com", "marie.curie@test.com")]
    [InlineData("Marie.Curie", "marie.curie@test.com")]
    public void Guessable_passwords_are_refused(string password, string email) => Assert.NotNull(PasswordPolicy.Reject(password, email));
}

public class HubConnectionsTests
{
    private sealed class FakeConnection(string id) : HubCallerContext
    {
        public bool Aborted { get; private set; }
        public override string ConnectionId => id;
        public override string? UserIdentifier => null;
        public override ClaimsPrincipal? User => null;
        public override IDictionary<object, object?> Items { get; } = new Dictionary<object, object?>();
        public override IFeatureCollection Features { get; } = new FeatureCollection();
        public override CancellationToken ConnectionAborted => CancellationToken.None;
        public override void Abort() => Aborted = true;
    }

    [Fact]
    public void Abort_cuts_every_connection_of_that_user_and_nobody_elses()
    {
        var hubs = new HubConnections();
        FakeConnection phone = new("a"), laptop = new("b"), neighbour = new("c");
        Guid me = Guid.NewGuid(), other = Guid.NewGuid();
        hubs.Track(me, phone);
        hubs.Track(me, laptop);
        hubs.Track(other, neighbour);

        hubs.Abort(me);

        Assert.True(phone.Aborted && laptop.Aborted);
        Assert.False(neighbour.Aborted);
    }

    [Fact]
    public void A_closed_connection_is_forgotten_and_an_unknown_user_is_a_no_op()
    {
        var hubs = new HubConnections();
        FakeConnection closed = new("a"), open = new("b");
        var me = Guid.NewGuid();
        hubs.Track(me, closed);
        hubs.Track(me, open);

        hubs.Untrack(me, "a");   // la connexion s'est fermée d'elle-même
        hubs.Abort(me);
        Assert.False(closed.Aborted);
        Assert.True(open.Aborted);

        hubs.Untrack(me, "b");
        hubs.Untrack(Guid.NewGuid(), "z");
        hubs.Abort(me);          // plus rien de suivi : aucune erreur
    }
}
