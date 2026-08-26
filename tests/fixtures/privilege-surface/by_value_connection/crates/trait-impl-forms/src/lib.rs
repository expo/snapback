pub trait Project {
    type Output;

    fn project(self) -> Self::Output;
}

pub struct Wrapper<T>(pub T);

impl<T> Project for Wrapper<T> {
    type Output = T;

    fn project(self) -> T {
        self.0
    }
}

mod hidden {
    pub trait GivesHandle {
        fn handle(&self) -> rusqlite::Connection;
    }
}

pub fn leak() -> Box<dyn hidden::GivesHandle> {
    panic!("scanner corpus is not executed")
}

pub trait PublicHandle: hidden::GivesHandle {}
