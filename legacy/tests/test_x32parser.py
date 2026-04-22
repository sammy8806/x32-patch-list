import io
import textwrap
import unittest

from x32parser import ScnParser


def parse_scene(scene_text):
    parser = ScnParser()
    parser.ParseFile(io.StringIO(textwrap.dedent(scene_text).strip() + "\n"))
    return parser


class ScnParserRoutingTests(unittest.TestCase):
    def test_user_routing_maps_aes50_b_correctly(self):
        parser = parse_scene(
            """
            /config/userrout/in/01 81
            """
        )

        self.assertEqual(parser.user_route_by_name['user-in.01'], 'aes50b.01')

    def test_duplicate_user_input_routes_keep_all_aes50_assignments(self):
        parser = parse_scene(
            """
            /config/userrout/in/01 33 33
            /config/routing/IN/1-8 UIN1-8
            /ch/01/config VocalA 0 RD 1
            /ch/02/config VocalB 0 BL 2
            """
        )

        routed_channels = parser.GetChannelListForType('aes50a')[0]

        self.assertEqual(
            [channel['name'] for channel in routed_channels],
            ['VocalA', 'VocalB']
        )

    def test_play_routing_becomes_active_when_route_switch_is_play(self):
        parser = parse_scene(
            """
            /config/routing/routswitch 1
            /config/routing/IN/1-8 AN1-8
            /config/routing/PLAY/1-8 A1-8
            /ch/01/config PlaybackVox 0 RD 1
            """
        )

        self.assertEqual(
            [channel['name'] for channel in parser.GetChannelListForType('aes50a')[0]],
            ['PlaybackVox']
        )
        self.assertIsNone(parser.GetChannelListForType('in')[0])

    def test_user_route_position_tracks_slot_not_last_duplicate_source(self):
        parser = parse_scene(
            """
            /config/userrout/out/01 169 169
            /config/routing/AES50A/1-8 UOUT1-8
            """
        )

        self.assertEqual(parser.GetUserRoutePosition('aes50a.01'), 'user-out.01')
        self.assertEqual(parser.GetUserRoutePosition('aes50a.02'), 'user-out.02')


if __name__ == '__main__':
    unittest.main()
