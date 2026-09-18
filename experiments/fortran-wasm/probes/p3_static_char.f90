program p
  type :: t
    character(len=:), allocatable :: name
  end type
  type(t) :: b
  b%name = "hello"
  print *, "P3 OK ", b%name
end program
